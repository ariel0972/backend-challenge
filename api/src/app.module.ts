/* eslint-disable prettier/prettier */
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { FinancialController } from "./http/financial.controller";
import { ReferenceWorker } from "./application/reference-worker";
import { MessagingWorker } from "./infrastructure/messaging/messaging.worker";

@Module({
  imports: [DatabaseModule],
  controllers: [AppController, FinancialController],
  providers: [
    AppService,
    ReferenceWorker,
    MessagingWorker,
  ],
})
export class AppModule { }