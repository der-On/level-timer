'use strict';

var debug = require('debug')('level-time:api');
var multilevel = require('multilevel');
var net = require('net');
var uuid = require('uuid').v4;
var merge = require('lodash/merge');
var sublevel = require('sublevel');

function generateId() {
  return (new Date()).getTime() + ':' + uuid();
}

module.exports = function Api (opts) {
  var opts = {};
  opts.host = opts.host || process.env.BACKEND_HOST || '127.0.0.1';
  opts.username = opts.username || process.env.BACKEND_USERNAME || null;
  opts.password = opts.password || process.env.BACKEND_PASSWD || null;
  opts.port = opts.port || process.env.BACKEND_PORT || 4567;

  var api = {};
  var db = multilevel.client();
  api.db = sublevel(db);
  api.connection = net.connect(opts.port, opts.host);
  api.connection
    .pipe(db.createRpcStream())
    .pipe(api.connection);
  debug('connected to backend at port %s:%d', opts.host, opts.port);

  var timeEntries = api.db.sublevel('time_entries');

  api.createTimeEntry = function (data) {
    data = data || {};

    if (!data.title) {
      throw new Error('Missing title');
    }

    var entry = merge(data, {
      id: generateId(),
      start: new Date(),
      end: null
    });
  };

  api.tracker = {};
  api.tracker.start = function (group, data) {
    return new Promise(function (resolve, reject) {
      try {
        var entry = api.createTimeEntry(data);
      } catch (err) {
        return reject(err);
      }

      timeEntries
        .sublevel(group)
        .put(entry.id, entry, function (err, entry) {
          if (err) return reject(err);
          debug('started %s:%s', group, entry.id);
          resolve(entry);
        });
    });
  };

  api.tracker.get = function (group, id) {
    return new Promise(function (resolve, reject) {
      if (!group) {
        return reject(new Error('Missing group'));
      }

      if (!id) {
        return reject(new Error('Missing id'));
      }

      timeEntries
        .sublevel(group)
        .get(id, function (err, entry) {
          if (err) return reject(err);
          if (!entry) return reject(new Error('Not found'));
          resolve(entry);
        });
    });
  }

  api.tracker.stop = function (group, id) {
    return new Promise(function (resolve, reject) {
      if (!group) {
        return reject(new Error('Missing group'));
      }

      if (!id) {
        return reject(new Error('Missing id'));
      }

      api.tracker.update(group, id, { end: new Date() })
        .then(function (entry) {
          debug('stopped %s:%s', group, id);
          resolve(entry);
        })
        .catch(reject);
    });
  };

  api.tracker.update = function (group, id, data) {
    return new Promise(function (resolve, reject) {
      if (!group) {
        return reject(new Error('Missing group'));
      }

      if (!id) {
        return reject(new Error('Missing id'));
      }

      api.tracker.get(group, id)
        .then(function (entry) {
          timeEntries.put(id, entry, function (err, entry) {
            if (err) return reject(err);
            debug('updated %s:%s', group, id);
            reslove(entry);
          });
        })
        .catch(reject);
    });
  };

  api.tracker.remove = function (group, id) {
    return new Promise(function (resolve, reject) {
      if (!group) {
        return reject(new Error('Missing group'));
      }

      if (!id) {
        return reject(new Error('Missing id'));
      }

      timeEntries
        .sublevel(group)
        .del(id, function (err) {
          if (err) return reject(err);
          debug('removed %s:%s', group, id);
          resolve(null);
        });
    });
  };

  api.tracker.filter = function (group, filter) {
    if (!filter) {
      filter = group;
      group = null;
    }

    return new Promise(function (resolve, reject) {
      var entries = [];

      if (group) {
        timeEntries = timeEntries.sublevel(group);
      }

      timeEntries
        .createReadStream()
        .on('data', function (key, entry) {
          if (filter(entry)) entries.push(entry);
        })
        .on('error', reject)
        .on('end', function () {
          resolve(entries);
        });
    });
  };

  return api;
};