/* eslint-disable prettier/prettier */
import { MikroORM } from "@mikro-orm/postgresql";
import {
  processWager,
  type WagerInput,
} from "./process-wager";

export function placeBet(
  orm: MikroORM,
  input: Omit<WagerInput, "kind">,
) {
  return processWager(orm, { ...input, kind: "BET" });
}
