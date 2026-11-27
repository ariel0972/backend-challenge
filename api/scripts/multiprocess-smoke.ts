import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
    access,
    mkdtemp,
    writeFile,
    unlink,
    rmdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";
import {
    processWager,
    type WagerInput,
} from "../src/application/process-wager";
import { reconcileWallet } from "../src/application/reconcile-wallet";
import { WalletEntity } from "../src/infrastructure/database/wallet.entity";
import { LedgerEntryEntity } from "../src/infrastructure/database/ledgerEntry.entity";
import { TransactionEntity } from "../src/infrastructure/database/transaction.entity";

const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function waitUntil(
    condition: () => Promise<boolean>,
    timeout = 20_000,
): Promise<void> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (await condition()) return;
        await sleep(50);
    }

    throw new Error("PROCESS_BARRIER_TIMEOUT");
}

interface WorkerArguments {
    directory: string;
    index: number;
    count: number;
    input: WagerInput;
}

async function worker(args: WorkerArguments): Promise<void> {
    const orm = await MikroORM.init(config);

    try {
        await writeFile(
            join(args.directory, `ready-${args.index}`),
            "ready",
        );

        await waitUntil(() => exists(join(args.directory, "go")));

        const results = await Promise.all(
            Array.from({ length: args.count }, () =>
                processWager(orm, args.input),
            ),
        );

        assert.equal(
            new Set(results.map((result) => result.transactionId)).size,
            1,
        );

        for (const result of results) {
            assert.equal(result.status, "PROCESSED");
            assert.equal(result.balance.amount, "90.00");
        }

        console.log(`Processo ${args.index}: ${args.count} chamadas OK`);
    } finally {
        await orm.close();
    }
}

async function coordinator(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "wager-processes-"));
    const orm = await MikroORM.init(config);
    const children: ReturnType<typeof Bun.spawn>[] = [];

    try {
        const playerId = randomUUID();

        const wallet = await openWallet(orm, {
            playerId,
            amount: "100.00",
            currency: "BRL",
        });

        const input: WagerInput = {
            walletId: wallet.id,
            amount: "10.00",
            currency: "BRL",
            kind: "BET",
            idempotencyKey: randomUUID(),
            context: {
                providerId: "multiprocess-smoke",
                externalTransactionId: randomUUID(),
                playerId,
                roundId: randomUUID(),
                gameId: "integration",
            },
        };

        const counts = [17, 17, 16];

        for (const [index, count] of counts.entries()) {
            const args: WorkerArguments = {
                directory,
                index,
                count,
                input,
            };

            children.push(Bun.spawn({
                cmd: [
                    process.execPath,
                    "--env-file=.env",
                    import.meta.path,
                    "--worker",
                    JSON.stringify(args),
                ],
                cwd: process.cwd(),
                env: process.env,
                stdout: "inherit",
                stderr: "inherit",
            }));
        }

        await waitUntil(async () => {
            const ready = await Promise.all(
                counts.map((_, index) =>
                    exists(join(directory, `ready-${index}`)),
                ),
            );

            return ready.every(Boolean);
        });

        // Os três processos já abriram suas próprias conexões.
        await writeFile(join(directory, "go"), "go");

        const exitCodes = await Promise.race([
            Promise.all(children.map((child) => child.exited)),
            sleep(30_000).then(() => {
                throw new Error("WORKERS_TIMEOUT");
            }),
        ]);

        assert.deepEqual(exitCodes, [0, 0, 0]);

        const em = orm.em.fork();
        const saved = await em.findOneOrFail(WalletEntity, {
            id: wallet.id,
        });

        assert.equal(saved.balance, "90.00");
        assert.equal(saved.version, 2);

        assert.equal(
            await em.count(TransactionEntity, {
                idempotencyKey: input.idempotencyKey,
            }),
            1,
        );

        assert.equal(
            await em.count(LedgerEntryEntity, {
                walletId: wallet.id,
                direction: "DEBIT",
            }),
            1,
        );

        const reconciliation = await reconcileWallet(orm, wallet.id);
        assert.equal(reconciliation.consistent, true);

        const execution = { idempotentReplay: false };

        const replay = await processWager(
            orm,
            input,
            false,
            undefined,
            execution,
        );

        assert.equal(execution.idempotentReplay, true);
        assert.equal(replay.balance.amount, "90.00");

        console.log({
            result: "MULTIPROCESS_SMOKE_OK",
            processes: 3,
            concurrentRequests: 50,
            walletId: wallet.id,
            balance: saved.balance,
            debits: 1,
            consistent: reconciliation.consistent,
            idempotentReplay: execution.idempotentReplay,
        });
    } finally {
        for (const child of children) {
            child.kill();
        }

        await Promise.allSettled(children.map((child) => child.exited));
        await orm.close();

        // Remove somente os quatro arquivos criados por este teste.
        for (const name of ["ready-0", "ready-1", "ready-2", "go"]) {
            await unlink(join(directory, name)).catch(() => undefined);
        }

        await rmdir(directory).catch(() => undefined);
    }
}

async function main(): Promise<void> {
    if (process.argv[2] === "--worker") {
        await worker(JSON.parse(process.argv[3]!) as WorkerArguments);
    } else {
        await coordinator();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});