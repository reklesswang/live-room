'use strict';

const moment = require('moment');
const jwt = require('jsonwebtoken');
const querystring = require('querystring');
const mysql2 = require('mysql2/promise');
const config = require('js-kernel/config');
const mysql = require('js-core/mysql').create({config, mysql: mysql2});
const users = require('js-core/users').create({mysql, querystring});
const errors = require('js-core/errors');
const utils = require('js-core/utils').create({querystring});
const auth = require('js-kernel/auth').create({config, jwt, moment});
const consts = require('js-kernel/consts').create({moment});
const ioredis = require('ioredis');
const redis = require('js-core/redis').create({config: config.redis, redis: ioredis});

async function userDelete(q, user) {
  console.log(`delete params q=${JSON.stringify(q)}, user=${JSON.stringify(user)}`);

  // Clear sessions for user, by phone.
  if (user.phone) {
    await mysql.query('DELETE FROM sessions WHERE phone=?', [user.phone]);
  }

  // Clear sessions for user, by email.
  if (user.email) {
    await mysql.query('DELETE FROM sessions WHERE email=?', [user.email]);
  }

  // Delete user information.
  if (user.userId) {
    const [rows] = await mysql.query('DELETE FROM users WHERE userId=?', [user.userId]);

    if (!rows) throw errors.create(errors.ServiceDBFailed, `users db failed`);
    if (rows.affectedRows !== 1) throw errors.create(errors.ServiceDBFailed, `users db failed, rows=${rows.affectedRows}`);
  }

  // Delete user ID from generator.
  if (user.userId && !isNaN(user.userId)) {
    const [rows] = await mysql.query('DELETE FROM id_generator WHERE id=?', [user.userId]);

    if (!rows) throw errors.create(errors.ServiceDBFailed, `generator db failed`);
    // If id is not generated by aPaaS, the affectedRows is 0.
    // If id is generated by aPaaS, the affectedRows is 1.
    if (rows.affectedRows !== 0 && rows.affectedRows !== 1) {
      throw errors.create(errors.ServiceDBFailed, `generator db failed, rows=${rows.affectedRows}`);
    }
  }

  return;
}

async function userOffline(q) {
  // TODO: FIXME: Cleanup rooms and music.
  // Remove online user from cache.
  if (process.env.REDIS_HOST) {
    await redis.hdel(consts.redis.DEMOS_ONLINE_USERS, q.userId);
  }
}

exports.main_handler = async (ctx) => {
  // Parse query params and check it.
  const q = utils.parseKoaRequest(ctx);

  if (!q.userId) throw errors.create(errors.UserTokenInvalid, `userId required`);
  if (!q.token) throw errors.create(errors.UserTokenInvalid, `token required, userId=${q.userId}`);

  // Require auth for user.
  await auth.authByUserToken(q.token, q.userId);

  // Query user information.
  let user = null;
  try {
    user = await users.userQuery({userId: q.userId});
  } catch (err) {
    // Success if user not exists(already delete).
    if (err instanceof Object && err.errorCode === errors.UserNotExists) {
      console.warn(`user already delete, userId=${q.userId}, token=${q.token}`);
      throw errors.data(null, 'already delete');
    }
    throw err;
  }

  // User offline now.
  await userOffline(q);

  // User delete, clear all information of user.
  await userDelete(q, user);

  // Done.
  console.log(`delete done userId=${q.userId}, token=${q.token}`);
  return errors.data(null, `delete ok`);
};
