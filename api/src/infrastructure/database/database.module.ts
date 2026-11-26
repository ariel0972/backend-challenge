/* eslint-disable prettier/prettier */
import {
    Inject,
    Injectable,
    Module,
    type OnApplicationShutdown,
} from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../../mikro-orm.config";

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
    constructor(
        @Inject(MikroORM)
        private readonly orm: MikroORM,
    ) { }

    async onApplicationShutdown(): Promise<void> {
        await this.orm.close();
    }
}

@Module({
    providers: [
        {
            provide: MikroORM,
            useFactory: async () => MikroORM.init(config),
        },
        DatabaseShutdown,
    ],
    exports: [MikroORM],
})
export class DatabaseModule { }