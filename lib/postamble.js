async.forEachSeries(
  nodes,
  function(item, cb) { if (item.${method}) item.${method}(util.force(cb, 'registered cb')); else cb(); },
  function(err) {
    if (err) throw err;
  }
);