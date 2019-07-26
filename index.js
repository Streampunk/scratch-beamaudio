/* Copyright 2019 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

const portAudio = require('naudiodon');
const beamcoder = require('beamcoder');
const oscServer = require('./oscServer.js');

// const ai = new portAudio.AudioIO({
//   inOptions: {
//     highwaterMark: 1024,
//     channelCount: 2,
//     sampleFormat: portAudio.SampleFormat16Bit,
//     sampleRate: 48000,
//     deviceId: 1
//   }
// });

const ao = new portAudio.AudioIO({
  outOptions: {
    highwaterMark: 1024,
    channelCount: 2,
    sampleFormat: portAudio.SampleFormat16Bit,
    sampleRate: 48000,
    deviceId: -1 // Use -1 or omit the deviceId to select the default device
  }
});

const oscControls = {
  'volume@0': {
    updated: false,
    val: { volume: 1.0, mute: false },
    osc: [
      {
        name: '/1/fader1',
        cur: function() { return [{ type: 'f', value: this.val.volume }]; },
        fn: function(values) { this.val.volume = values[0]; this.updated = true; }
      },
      {
        name: '/1/toggle1',
        cur: function() { return [{ type: 'f', value: this.val.mute ? 1.0 : 0.0 }]; },
        fn: function(values) { this.val.mute = 1 === values[0]; this.updated = true; }
      }
    ],
    mod: function() { return this.updated; },
    msg: function() {
      this.updated = false;
      return {
        volume: this.val.mute ? '0' : this.val.volume.toString()
      };
    }
  },
  'agate@1': { // :( doesn't respond to updates - priv values change but filter ignores :(
    updated: false,
    val: { attack: 20, release: 2000 },
    osc: [
      {
        name: '/1/fader3',
        cur: function() { return [{ type: 'f', value: this.val.attack / 9000.0 }]; },
        fn: function(values) { this.val.attack = values[0] * 9000.0; this.updated = true; }
      },
      {
        name: '/1/fader4',
        cur: function() { return [{ type: 'f', value: this.val.release / 9000.0 }]; },
        fn: function(values) { this.val.release = values[0] * 9000.0; this.updated = true; }
      }
    ],
    mod: function() { return this.updated; },
    msg: function() {
      this.updated = false;
      return {
        attack: Math.max(0.01, this.val.attack),
        release: Math.max(0.01, this.val.release)
      };
    }
  },
  'acompressor@4': {
    updated: false,
    val: { level_in: 0.1 },
    osc: [
      {
        name: '/1/fader2',
        cur: function() { return [{ type: 'f', value: this.val.level_in / 64.0 }]; },
        fn: function(values) { this.val.level_in = values[0] * 64.0; this.updated = true; }
      }
    ],
    mod: function() { return this.updated; },
    msg: function() {
      this.updated = false;
      return {
        level_in: Math.max(0.015625, this.val.level_in)
      };
    }
  }
};

// const fs = require('fs');
async function run() {
  // const demuxers = beamcoder.demuxers();
  // const iformat = demuxers[Object.keys(demuxers).find(k => demuxers[k].name === 's16le')];
  const urls = [ 'file:../../Media/sound/BBCNewsCountdown.wav' ];
  // const urls = [ 'file:../../Media/Another-Day-Another-Beat.wav' ];
  // const rs = fs.createReadStream(urls[0]);
  const spec = { start: 0, end: 50 };
  var tag = 0;
  const params = {
    video: [],
    audio: [
      {
        sources: [{
          url: urls[0],
          // input_stream: ai,
          // iformat: iformat,
          // options: {
          //   sample_rate: 48000, channels: 2, probesize: 32,
          //   avioflags: 'direct', packetsize: 1024, fflags: 'nobuffer' },
          ms: spec,
          streamIndex: 0 
        }],
        filterSpec: `[in0:a] \
                     volume@${tag++}=precision=fixed:volume=1.0, \
                     agate@${tag++}=attack=20:release=2000, \
                     equalizer@${tag++}=f=1000:t=h:width=200:g=2, \
                     equalizer@${tag++}=f=200:t=q:w=2:g=-20, \
                     acompressor@${tag++}=level_in=0.5:attack=15:release=752:threshold=0.07, \
                     aformat@${tag++}=sample_fmts=s16:channel_layouts=stereo:sample_rates=48000 \
                     [out0:a]`,
        streams: [
          { name: 'pcm_s16le', time_base: [1, 48000],
            codecpar: {
              sample_rate: 48000, format: 's16le', channel_layout: 'stereo'
            }
          }
          // { name: 'aac', time_base: [1, 90000],
          //   codecpar: {
          //     sample_rate: 48000, format: 'fltp', channel_layout: 'stereo'
          //   }
          // }
        ]
      },
    ],
    out: {
      // url: 'file:temp.mp4',
      // formatName: 'mp4',
      formatName: 's16le',
      output_stream: ao,
      flags: { DIRECT: true },
      options: { flags: { AVFMT_NOFILE: true }, fflags: 'flush_packets' }
    }
  };

  // ai.once('data', () => ao.start());
  // ai.start();
  await beamcoder.makeSources(params);
  const beamStreams = await beamcoder.makeStreams(params);

  const oscServ = new oscServer;
  params.audio.forEach(p => {
    const stream = p.sources[0].format.streams[p.sources[0].streamIndex];
    const elems = p.filter.graph.filters.filter(f => f.name.includes('@'));

    // console.log(p.filter.graph.dump());

    // const filterControls = {};
    // elems.forEach(e => {
    //   const elemControls = {};
    //   const options = e.filter.priv_class.options;
    //   Object.keys(options).forEach(o => {
    //     elemControls[options[o].name] = { description: options[o].help, type: options[o].option_type };
    //     if (options[o].consts) elemControls[options[o].name].consts = options[o].consts;
    //   });
    //   filterControls[e.name] = elemControls;
    // });
    // console.log(filterControls);

    const filterCallbacks = [];
    Object.keys(oscControls).forEach(c => {
      const filt = elems.find(f => f.name === c);
      if (filt) {
        oscControls[c].osc.forEach(o => {
          oscServ.addControl(o.name, o.fn.bind(oscControls[c]));
          oscServ.sendMsg(o.name, o.cur.bind(oscControls[c])());
        });
        filterCallbacks.push({ 
          filt: filt, 
          mod: oscControls[c].mod.bind(oscControls[c]),
          msg: oscControls[c].msg.bind(oscControls[c])
        });
      }
    });
    p.filter.cb = pts => {
      // if (global.gc) global.gc();
      const ts = pts * stream.time_base[0] / stream.time_base[1];
      filterCallbacks.forEach(c => {
        if (c.mod())
          c.filt.priv = c.msg(ts);
      });
    };
  });

  setTimeout(ao.start, 200);
  await beamStreams.run();
  oscServ.close();
}

let start = Date.now();
run()
  .then(() => console.log(`Finished ${Date.now() - start}ms`))
  .catch(console.error);
