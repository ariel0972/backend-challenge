/* eslint-disable prettier/prettier */
import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { WalletSchema } from "./infrastructure/database/wallet.entity";
import { TransactionSchema } from "./infrastructure/database/transaction.entity";
import { LedgerEntrySchema } from "./infrastructure/database/ledgerEntry.entity";

export default defineConfig({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? "5000"),
  dbName: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  entities: [WalletSchema, TransactionSchema, LedgerEntrySchema],
  extensions: [Migrator],
  schemaGenerator: {
    skipTables: ["inbox_messages", "outbox_events"],
  },

  migrations: {
    path: "./dist/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
  },
});
