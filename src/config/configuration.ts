import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Config, Default, Objectype, Production } from './config.interface.js';

// V2026-11-02 ESM: __dirname 在 ESM 不可用, 用 fileURLToPath(import.meta.url) 推导.
//   命名避开 no-underscore-dangle / naming-convention 规则.
const currentDirname = path.dirname(fileURLToPath(import.meta.url));

const util = {
  isObject<T>(value: T): value is T & Objectype {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  },
  merge<T extends Objectype, U extends Objectype>(target: T, source: U): T & U {
    for (const key of Object.keys(source)) {
      const targetValue = target[key];
      const sourceValue = source[key];
      if (this.isObject(targetValue) && this.isObject(sourceValue)) {
        Object.assign(sourceValue, this.merge(targetValue, sourceValue));
      }
    }

    return { ...target, ...source };
  },
};

export const configuration = async (): Promise<Config> => {
  // V2026-11-02 ESM: dynamic import() 必须传完整 file:// URL.
  //   编译后 dist/config/configuration.js 与 dist/config/envs/*.js 同级,
  //   currentDirname 指向 dist/config, 路径推导跟原 CJS 一致.
  const defaultUrl = pathToFileURL(path.join(currentDirname, 'envs', 'default.js'));
  const envUrl = pathToFileURL(path.join(currentDirname, 'envs', `${process.env.NODE_ENV || 'development'}.js`));

  const { config } = <{ config: Default }>await import(defaultUrl.href);
  const { config: environment } = <{ config: Production }>await import(envUrl.href);

  // object deep merge
  return util.merge(config, environment);
};
