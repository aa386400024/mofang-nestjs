import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Sampletable1 } from '#entity/sampledb1/index.js';
import { withGraphqlDepthLimit } from './gql-options.js';
import { AuthModule } from '../auth/auth.module.js';
import { SimpleService } from './providers/index.js';
import { SimpleResolver } from './resolvers/index.js';
import { DateScalar } from './scalars/index.js';

/**
 * https://docs.nestjs.com/graphql/quick-start
 */
@Module({
  imports: [
    AuthModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: (config: ConfigService) => withGraphqlDepthLimit(config.get<ApolloDriverConfig>('graphql')),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Sampletable1]),
  ],
  providers: [SimpleResolver, SimpleService, DateScalar],
})
export class GqlModule {}
