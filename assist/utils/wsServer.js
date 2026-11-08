const _io = require("socket.io");
const {getCompressionConfig} = require("./helper");

let io;

const getServer = function () {
    return io;
}

const fetchSockets = async function (roomID) {
    if (!io) {
        return [];
    }
    if (!roomID) {
        return await io.fetchSockets();
    }
    return await io.in(roomID).fetchSockets();
}

const createSocketIOServer = function (server, prefix) {
    if (io) {
        return io;
    }
    io = _io(server, {
        maxHttpBufferSize: (parseFloat(process.env.maxHttpBufferSize) || 5) * 1e6,
        cors: {
            origin: "*",
            methods: ["GET", "POST", "PUT"]
        },
        path: (prefix ? prefix : '') + '/socket',
        ...getCompressionConfig()
    });
    attachRedisAdapter(io);   // add lee 2026.11.7
    return io;
}

// add lee 2026.11.7 看屏服务多实例（负载均衡）：设了 PG_ASSIST_REDIS_URL 才接 Redis 适配器，
// 多个实例经 Redis 发布订阅互通（io.to / socket.to / fetchSockets 自动跨实例）；不设则与官方单实例完全一样。
// 只用发布订阅、不写键；频道前缀 PG_ASSIST_REDIS_KEY（默认 pg-or-assist），共用 Redis 时防止与其它系统串频道。
function attachRedisAdapter(server) {
    const url = process.env.PG_ASSIST_REDIS_URL;
    if (!url) {
        return;
    }
    const {logger} = require('./logger');
    const {createAdapter} = require('@socket.io/redis-adapter');
    const {createClient} = require('redis');
    const key = process.env.PG_ASSIST_REDIS_KEY || 'pg-or-assist';
    // 断线重连间隔逐步拉长（0.5s、1s… 最长 10s），Redis 不可用时不刷屏
    const pub = createClient({url, socket: {reconnectStrategy: (retries) => Math.min((retries + 1) * 500, 10000)}});
    const sub = pub.duplicate();
    pub.on('error', (e) => logger.error(`pg redis adapter pub error: ${e}`));
    sub.on('error', (e) => logger.error(`pg redis adapter sub error: ${e}`));
    Promise.all([pub.connect(), sub.connect()])
        .then(() => {
            server.adapter(createAdapter(pub, sub, {key}));
            logger.info(`pg redis adapter enabled, key=${key}`);
        })
        .catch((e) => logger.error(`pg redis adapter connect failed, stay single-instance: ${e}`));
}
// end

module.exports = {
    createSocketIOServer,
    getServer,
    fetchSockets,
}