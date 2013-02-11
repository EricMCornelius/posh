var assert = require('assert');
var util = require('util');
var mkdirp = require('mkdirp');
var async = require('async');
var path = require('path');
var http = require('http');
var https = require('https');
var fs = require('fs');
var url = require('url');
var tar = require('tar');
var zlib = require('zlib');
var AdmZip = require('adm-zip');

var exec = require('child_process').exec;

require('../../extensions/extensions.js');

var exists = util.exists;
var launch = util.launch;
var message = util.message;

function register(node, registry, cb) {
  var config = node.wget;

  if (exists(config)) {
    assert(exists(config.url), 'No url specified');
    var urlObj = url.parse(config.url);
    config.targetdir = path.resolve(node.env.base, config.targetdir || path.dirname(config.target) || '.');
    config.target = path.basename(config.target || urlObj.pathname);
    config.protocol = urlObj.protocol;

    node.update = function(cb) {
      processors['wget'].update(this, cb);
    }
  }

  cb();
}

function wget(url_, protocol, target, cb) {
  var file = fs.createWriteStream(target);
  var client;
  switch (protocol) {
    case 'http:':
      client = http;
      break;
    case 'https:':
      client = https;
      break;
    default:
      console.log('Unrecognized protocol: ' + protocol);
      return cb('Unrecognized protocol: ' + protocol);
  }

  client.get(url_, function(res) {
    console.log(res.headers);
    if (res.statusCode === 200) {
      res.pipe(file).on('close', cb);
      res.on('error', function(err) { console.log(err); cb(); });
    }
    else if(res.statusCode === 301 || res.statusCode === 302) {
      var urlObj = url.parse(res.headers.location);
      wget(res.headers.location, urlObj.protocol, target, cb);
    }
  });
}

function extract(source, target, cb) {
  fs.createReadStream(source)
    .pipe(zlib.Unzip())
    .on('error', cb)
    .pipe(tar.Extract({ path: target }))
    .on('error', cb)
    .on('end', function() { cb(); });
}

function unzip(source, target, cb) {
  try {
    var zip = new AdmZip(source);
    zip.extractAllTo(target, true);
  }
  catch(err) {
    cb(err);
  }
  cb();
}

function update(node, cb) {
  var config = node.wget;
  var target = path.join(config.targetdir, config.target);

  var steps = [
    async.apply(mkdirp, config.targetdir),
    message('Retrieving source from: ' + config.url),
    async.apply(wget, config.url, config.protocol, target)
  ];

  if (target.endsWith('.tar.gz')) {
    steps = steps.concat([
      message('Extracting file: ' + target),
      async.apply(extract, target, config.targetdir)
    ]);
  } 

  if (target.endsWith('.zip')) {
    steps = steps.concat([
      message('Extracting file: ' + target),
      async.apply(unzip, target, config.targetdir)
    ]);
  }

  async.series(steps, cb);
}

module.exports.register = register;
module.exports.update = update;
module.exports.name = 'wget';