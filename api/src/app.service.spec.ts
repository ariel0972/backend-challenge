import { expect, test } from "bun:test";
import { AppService } from "./app.service";

test('Retorna saudação', () => {
    const appService = new AppService()

    expect(appService.getHello()).toBe("Hello World!")
})