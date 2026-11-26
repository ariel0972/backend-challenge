/* eslint-disable prettier/prettier */
import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpException,
    Inject,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    Param,
    Post,
    ServiceUnavailableException,
    UnprocessableEntityException,
} from "@nestjs/common";
import {
    NotFoundError,
    UniqueConstraintViolationException,
} from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";
import { openWallet } from "../application/open-wallet";
import {
    processWager,
    type WagerKind,
} from "../application/process-wager";
import { WalletEntity } from "../infrastructure/database/wallet.entity";
import { TransactionEntity } from "../infrastructure/database/transaction.entity";
import { reconcileWallet } from "../application/reconcile-wallet";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        throw new BadRequestException({ code: "INVALID_BODY" });
    }

    return value as JsonObject;
}

function onlyKeys(value: JsonObject, allowed: string[]): void {
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new BadRequestException({ code: "UNKNOWN_FIELD" });
    }
}

function text(value: unknown, field: string, max = 200): string {
    if (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        value.length > max
    ) {
        throw new BadRequestException({
            code: "INVALID_FIELD",
            field,
        });
    }

    return value;
}

function uuid(value: unknown, field: string): string {
    const result = text(value, field, 36);

    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            result,
        )
    ) {
        throw new BadRequestException({
            code: "INVALID_UUID",
            field,
        });
    }

    return result.toLowerCase();
}

function money(value: unknown, positive: boolean) {
    const data = object(value);
    onlyKeys(data, ["amount", "currency", "referenceExternalTransactionId",]);

    const amount = text(data.amount, "amount", 21);
    const currency = text(data.currency, "currency", 3);

    // numeric(20,2): até 18 dígitos na parte inteira.
    if (!/^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/.test(amount)) {
        throw new BadRequestException({ code: "INVALID_AMOUNT" });
    }

    if (positive && amount === "0.00") {
        throw new BadRequestException({ code: "AMOUNT_MUST_BE_POSITIVE" });
    }

    // Escopo monetário explícito deste bloco.
    if (!["BRL", "USD"].includes(currency)) {
        throw new BadRequestException({ code: "UNSUPPORTED_CURRENCY" });
    }

    return { amount, currency };
}

@Controller()
export class FinancialController {
    private readonly logger = new Logger(FinancialController.name);

    constructor(
        @Inject(MikroORM)
        private readonly orm: MikroORM,
    ) { }

    private async execute<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            if (error instanceof NotFoundError) {
                throw new NotFoundException({ code: "RESOURCE_NOT_FOUND" });
            }

            if (error instanceof UniqueConstraintViolationException) {
                throw new ConflictException({ code: "RESOURCE_CONFLICT" });
            }

            if (
                error instanceof Error &&
                error.message === "IDEMPOTENCY_CONFLICT"
            ) {
                throw new ConflictException({ code: "IDEMPOTENCY_CONFLICT" });
            }

            const code =
                typeof error === "object" && error !== null && "code" in error
                    ? String(error.code)
                    : undefined;

            if (
                code &&
                [
                    "ECONNREFUSED",
                    "ECONNRESET",
                    "ETIMEDOUT",
                    "57P01",
                    "53300",
                    "40001",
                    "40P01",
                    "55P03",
                ].includes(code)
            ) {
                throw new ServiceUnavailableException({
                    code: "DATABASE_TEMPORARILY_UNAVAILABLE",
                });
            }

            // Não exponha SQL, credenciais ou payload no HTTP.
            this.logger.error(JSON.stringify({
                event: "http_operation_failed",
                errorType: error instanceof Error ? error.name : "UnknownError",
                code,
            }));

            throw new InternalServerErrorException({
                code: "INTERNAL_ERROR",
            });
        }
    }

    @Post("wallets")
    async createWallet(@Body() raw: unknown) {
        const body = object(raw);
        onlyKeys(body, ["playerId", "initialBalance"]);

        const playerId = uuid(body.playerId, "playerId");
        const initialBalance = money(body.initialBalance, false);

        return this.execute(async () => {
            const wallet = await openWallet(this.orm, {
                playerId,
                ...initialBalance,
            });

            return {
                id: wallet.id,
                playerId: wallet.playerId,
                balance: wallet.balance.toJSON(),
                version: wallet.version,
            };
        });
    }

    @Get("wallets/:walletId")
    async getWallet(@Param("walletId") rawId: string) {
        const id = uuid(rawId, "walletId");

        return this.execute(async () => {
            const wallet = await this.orm.em.fork().findOneOrFail(
                WalletEntity,
                { id },
            );

            return {
                id: wallet.id,
                playerId: wallet.playerId,
                balance: {
                    amount: wallet.balance,
                    currency: wallet.currency,
                },
                version: wallet.version,
            };
        });
    }

    @Post("wagering/transactions")
    @HttpCode(200)
    async submitTransaction(
        @Headers("idempotency-key") rawKey: unknown,
        @Body() raw: unknown,
    ) {
        const idempotencyKey = text(rawKey, "Idempotency-Key");
        const body = object(raw);

        onlyKeys(body, [
            "providerId",
            "externalTransactionId",
            "playerId",
            "walletId",
            "roundId",
            "gameId",
            "kind",
            "money",
        ]);

        const kind = text(body.kind, "kind");

        if (!["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"].includes(kind)) {
            throw new BadRequestException({
                code: "UNSUPPORTED_OPERATION",
            });
        }

        const reference =
            body.referenceExternalTransactionId === undefined
                ? undefined
                : text(
                    body.referenceExternalTransactionId,
                    "referenceExternalTransactionId",
                );

        if (["REFUND", "ROLLBACK"].includes(kind) && !reference) {
            throw new BadRequestException({ code: "REFERENCE_REQUIRED" });
        }

        if (kind === "BET" && reference) {
            throw new BadRequestException({ code: "UNEXPECTED_REFERENCE" });
        }

        const input = {
            walletId: uuid(body.walletId, "walletId"),
            ...money(body.money, kind !== "LOSS"),
            idempotencyKey,
            context: {
                providerId: text(body.providerId, "providerId"),
                externalTransactionId: text(
                    body.externalTransactionId,
                    "externalTransactionId",
                ),
                playerId: uuid(body.playerId, "playerId"),
                roundId: text(body.roundId, "roundId"),
                gameId: text(body.gameId, "gameId"),
            },
            kind: kind as WagerKind,
            referenceExternalTransactionId: reference,
        };

        return this.execute(async () => {
            const result = await processWager(this.orm, input);

            if (result.status === "REJECTED") {
                throw new UnprocessableEntityException(result);
            }
            if (result.status === "PENDING_REFERENCE") {
                throw new HttpException(result, 202);
            }

            return result;
        });
    }

    @Get("wagering/transactions/:transactionId")
    async getTransaction(@Param("transactionId") rawId: string) {
        const id = uuid(rawId, "transactionId");

        return this.execute(async () => {
            const transaction = await this.orm.em.fork().findOneOrFail(
                TransactionEntity,
                { id },
            );

            return {
                transactionId: transaction.id,
                walletId: transaction.walletId.id,
                kind: transaction.type,
                status: transaction.status,
                money: {
                    amount: transaction.amount,
                    currency: transaction.currency,
                },
                context: transaction.context ?? null,
                result: transaction.response ?? null,
                createdAt: transaction.createdAt,
            };
        });
    }

    @Post("wallets/:walletId/reconciliation")
    @HttpCode(200)
    async reconcile(@Param("walletId") rawId: string) {
        const id = uuid(rawId, "walletId");

        return this.execute(async () => {
            const result = await reconcileWallet(this.orm, id);

            if (!result.consistent) {
                this.logger.error(JSON.stringify({
                    event: "wallet_reconciliation_mismatch",
                    walletId: id,
                    checkedEntries: result.checkedEntries,
                }));
            }

            return result;
        });
    }

    @Get("health/live")
    live() {
        return { status: "ok" };
    }
}