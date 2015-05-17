var util = require('util');
var assert = require('assert');

function spacer(size) {
  size *= 2;
  var str = '';
  for (var x = 0; x < size; ++x)
    str += ' ';
  return str;
}

function serialize(obj, depth) {
  var sep = '';

  switch (typeof obj) {
    case 'number':
    case 'boolean':
    case 'function':
      return obj;
    case 'string':
      return '\'' + obj + '\'';
    case 'object':
      if (!depth)
        depth = 0;

      var predent = spacer(depth);
      var indent = spacer(depth + 1);

      if (util.isArray(obj)) {
        return obj.reduce(
          function(prev, curr, idx) {
            if (idx === 1)
              sep = ',\n' + indent;
            return prev + sep + serialize(curr, depth + 1);
          },
          '[\n' + indent
        ) + '\n' + predent + ']';
      }
      else {
        return Object.keys(obj).reduce(
          function(prev, curr, idx) {
            if (idx === 1)
              sep = ',\n' + indent;
            return prev + sep + '\'' + curr + '\': ' + serialize(obj[curr], depth + 1);
          },
          '{\n' + indent
        ) + '\n' + predent + '}';
      }
      break;
    case 'undefined':
      return undefined;
    default:
      assert(false, 'Unable to serialize object: ' + JSON.stringify(obj, null, 2));
      break;
  }
}

function minify(obj) {
  var sep = '';
  switch (typeof obj) {
    case 'number':
    case 'boolean':
    case 'function':
      return obj;
    case 'string':
      return '\'' + obj + '\'';
    case 'object':
      if (util.isArray(obj)) {
        return obj.reduce(
          function(prev, curr, idx) {
            if (idx === 1)
              sep = ',';
            return prev + sep + minify(curr);
          },
          '['
        ) + ']';
      }
      else {
        return Object.keys(obj).reduce(
          function(prev, curr, idx) {
            if (idx === 1)
              sep = ',';
            return prev + sep + '\'' + curr + '\': ' + minify(obj[curr]);
          },
          '{'
        ) + '}';
      }
      break;
    case 'undefined':
      return undefined;
    default:
      assert(false, 'Unable to serialize object: ' + JSON.stringify(obj, null, 2));
      break;
  }
}

module.exports.serialize = serialize;
module.exports.minify = minify;
