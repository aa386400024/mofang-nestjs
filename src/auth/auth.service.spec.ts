import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';

import type { JwtPayload, Payload } from './auth.interface.js';
import { AuthService } from './auth.service.js';

const payload: Payload = { userId: 'test', username: 'foobar', roles: ['test'] };

let moduleRef: TestingModule | undefined;
let auth: AuthService;
let jwt: JwtService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({ secret: 'access-secret' })],
    providers: [AuthService, { provide: ConfigService, useValue: new ConfigService({ jwtRefreshSecret: 'refresh-secret' }) }],
  }).compile();

  auth = moduleRef.get(AuthService);
  jwt = moduleRef.get(JwtService);
});

test('requires a refresh secret that differs from the access secret', () => {
  expect(() => new AuthService(jwt, new ConfigService({ jwtSecret: 'secret' }))).toThrow('JWT_REFRESH_SECRET');
  expect(() => new AuthService(jwt, new ConfigService({ jwtSecret: 'secret', jwtRefreshSecret: 'secret' }))).toThrow('JWT_REFRESH_SECRET');
});

test('jwtSign issues access token with jti and refresh token with its own secret', () => {
  const tokens = auth.jwtSign(payload);

  expect(jwt.verify<JwtPayload>(tokens.access_token)).toMatchObject({
    sub: 'test',
    username: 'foobar',
    roles: ['test'],
    type: 'access',
    iss: 'mofang-nestjs',
    aud: 'mofang-client',
  });
  expect(jwt.verify<JwtPayload>(tokens.access_token).jti).toBeTypeOf('string');
  expect(jwt.verify<JwtPayload>(tokens.refresh_token, { secret: 'refresh-secret' })).toMatchObject({ sub: 'test', type: 'refresh' });
  expect(() => jwt.verify<JwtPayload>(tokens.refresh_token)).toThrow();
});

test('validateRefreshToken accepts only the refresh token of the same user', () => {
  const tokens = auth.jwtSign(payload);

  expect(auth.validateRefreshToken(payload, tokens.refresh_token)).toBe(true);
  expect(auth.validateRefreshToken({ ...payload, userId: 'other' }, tokens.refresh_token)).toBe(false);
  // The access token is signed with another secret, so it must not work as a refresh token.
  expect(auth.validateRefreshToken(payload, tokens.access_token)).toBe(false);
});

test('getPayload returns null for a malformed token', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const notJson = Buffer.from('not json').toString('base64url');

  expect(auth.getPayload(auth.jwtSign(payload).access_token)).toEqual(payload);
  expect(auth.getPayload('not-a-jwt')).toBeNull();
  expect(auth.getPayload(`${header}.${notJson}.signature`)).toBeNull();
});

afterAll(async () => {
  await moduleRef?.close();
});
