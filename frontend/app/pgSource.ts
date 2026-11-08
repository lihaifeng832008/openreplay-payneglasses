// add lee 2026.11.8 AGPL-3.0 第 13 条：向通过网络使用本修改版的用户提供源码获取途径（登录页页脚 + 顶栏两处链接共用）
// 编译时可用 .env 或环境变量 PG_SOURCE_URL 覆盖；没设或为空时用下面的默认地址，保证链接不会丢
import ENV from '../env';

const PG_SOURCE_URL_DEFAULT =
  'https://github.com/lihaifeng832008/openreplay-payneglasses.git';

export const PG_SOURCE_URL = ENV.PG_SOURCE_URL || PG_SOURCE_URL_DEFAULT;
// end
