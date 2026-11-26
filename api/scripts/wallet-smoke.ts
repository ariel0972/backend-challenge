/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { Wallet } from "../src/domain/wallet";
import { Money } from "../src/domain/money";
import { WalletEntity } from "../src/infrastructure/database/wallet.entity";
import { WalletMapper } from "../src/infrastructure/database/wallet.mapper";

async function main() {
  const orm = await MikroORM.init(config);

  try {
    const em = orm.em.fork();

    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: randomUUID(),
      initialBalance: Money.zero("BRL"),
    });

    const entity = WalletMapper.toEntity(wallet);
    await em.persist(entity).flush();

    em.clear();

    const saved = await em.findOneOrFail(WalletEntity, { id: wallet.id });

    const recorverd = WalletMapper.toDomain(saved)

    console.log({ id: recorverd.id, balance: recorverd.balance.toJSON(), version: recorverd.version });
  } finally {
    await orm.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});