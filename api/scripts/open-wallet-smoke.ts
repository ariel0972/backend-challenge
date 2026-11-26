/* eslint-disable prettier/prettier */
import { randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/mikro-orm.config";
import { openWallet } from "../src/application/open-wallet";

async function main() {
  const orm = await MikroORM.init(config);

  try {
    const wallet = await openWallet(orm, {
      playerId: randomUUID(),
      amount: "100.00",
      currency: "BRL",
    });

    console.log({
      id: wallet.id,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    });
  } finally {
    await orm.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});