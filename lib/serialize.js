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
  switch (typeof obj) {
    case 'number':
    case 'boolean':
    case 'function':
      return obj;
      break;
    case 'string':
      return '\'' + obj + '\'';
      break;
    case 'object':
      if (!depth)
      depth = 0;
      var predent = spacer(depth);
      var indent = spacer(depth + 1);

      if (util.isArray(obj)) {
        var sep = '';
        return obj.reduce(
          function(prev, curr, idx, arr) {
            if (idx === 1)
              sep = ',\n' + indent;
            return prev + sep + serialize(curr, depth + 1);
          },
          '[\n' + indent
        ) + '\n' + predent + ']';
      }
      else {
        var sep = '';
        return Object.keys(obj).reduce(
          function(prev, curr, idx, arr) {
            if (idx === 1)
              sep = ',\n' + indent;
            return prev + sep + "'" + curr + "': " + serialize(obj[curr], depth + 1);
          },
          '{\n' + indent
        ) + '\n' + predent + '}';
      }
      break;
    default:
      assert(false, 'Unable to serialize object: ' + JSON.stringify(obj, null, 2));
      break;
  }
}

module.exports.serialize = serialize;