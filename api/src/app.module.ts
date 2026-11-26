/* eslint-disable prettier/prettier */
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { FinancialController } from "./http/financial.controller";
import { ReferenceWorker } from "./application/reference-worker";

@Module({
  imports: [DatabaseModule],
  controllers: [AppController, FinancialController],
  providers: [AppService, ReferenceWorker],
})
export class AppModule {}