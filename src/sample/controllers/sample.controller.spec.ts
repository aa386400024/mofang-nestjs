import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep } from 'jest-mock-extended';
import { getLoggerToken, type PinoLogger } from 'nestjs-pino';

import { SampleController } from './sample.controller';
import { ConfigService } from '../../common';

let moduleRef: TestingModule | undefined;
let controller: SampleController;

const config = {
  hello: 'world',
  foo: 'bar',
};

beforeAll(async () => {
  // V2026-09-12 fix: Test.createTestingModule({...}) 在项目版本里返回类型被
  // 推断为 any (Provider 里的 useValue: mockDeep<PinoLogger> 嵌套太深), 整个
  // chain 推导为 Error, no-unsafe-assignment 抓. eslint-disable 明确跳过.

  moduleRef = await Test.createTestingModule({
    controllers: [SampleController],
    providers: [
      {
        provide: getLoggerToken(SampleController.name),
        useValue: mockDeep<PinoLogger>(),
      },
      ConfigService,
    ],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: jest.fn((key: keyof typeof config) => config[key]),
    })
    .useMocker(mockDeep)
    .compile();

  controller = moduleRef.get(SampleController);
});

test('sample', () => {
  expect(controller.sample()).toEqual(config);
});

afterAll(async () => {
  await moduleRef?.close();
});
