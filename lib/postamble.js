async.forEachSeries(
  nodes,
  function(item, cb) { item.build(cb); },
  function(err) {
    if (err)
      console.log(err);
  }
);