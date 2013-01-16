#!/usr/bin/env node

var fs = require('fs');
var async = require('async');

function test(msg) {
  console.log(msg);
}


var nodes = [
  {
    id: 'test',
    build: function (cb) {
    console.log('hello world');
    cb();
  },
    env: {
      
    }
  },
  {
    id: 'test2',
    deps: [
      'test'
    ],
    build: function (cb) {
    console.log('goodbye world');
    cb();
  },
    env: {
      
    }
  },
  {
    id: 'Peg',
    git: {
      repo: 'https://github.com/EricMCornelius/Peg.git',
      branch: 'master',
      target: 'Peg'
    },
    env: {
      compiler: 'gcc'
    }
  },
  {
    id: 'test3',
    deps: [
      
    ],
    build: function (cb) {
          console.log(this.env.compiler);
          cb();
        },
    env: {
      compiler: 'gcc',
      compiler_flags: [
        '-std=c++11'
      ]
    }
  },
  {
    id: 'test4',
    deps: [
      
    ],
    build: function (cb) {
          console.log(this.env.compiler);
          cb();
        },
    env: {
      compiler: 'gcc',
      compiler_flags: [
        '-std=c++11'
      ]
    }
  },
  {
    id: 'test5',
    deps: [
      
    ],
    build: function (cb) {
          console.log(this.env.compiler);
          cb();
        },
    env: {
      compiler: 'gcc',
      compiler_flags: [
        '-std=c++11'
      ]
    }
  }
]

async.forEachSeries(
  nodes,
  function(item, cb) { item.build(cb); },
  function(err) {
    if (err)
      console.log(err);
  }
);