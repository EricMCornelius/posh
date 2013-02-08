var fs = require('fs');

// extends fs with an asynchronous copy function
fs.copy = function (src, dst, cb) {
  function copy(err) {
    var is, os;

    fs.stat(src, function (err) {
      if (err)
        return cb(err);

      is = fs.createReadStream(src);
      os = fs.createWriteStream(dst);
      util.pump(is, os, cb);
    });
  }

  fs.stat(dst, copy);
};

//extends fs with file existence check
