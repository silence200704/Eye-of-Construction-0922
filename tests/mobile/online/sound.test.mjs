import {test} from 'node:test'
import assert from 'node:assert/strict'
import {native} from '../nativeLoader.mjs'
import {deferred} from '../fixture.mjs'
const {SoundCue,cueBytes}=native('core/alerts/SoundCue.ets')

test('sound cue is a short local PCM buffer and stops/releases after one playback',async()=>{
 const events=[];const renderer={start:async()=>events.push('start'),write:async b=>{events.push('write');return b.byteLength},
 drain:async()=>events.push('drain'),stop:async()=>events.push('stop'),release:async()=>events.push('release')}
 const cue=new SoundCue(async()=>renderer)
 assert.equal(cueBytes().byteLength,4800)
 assert.equal(await cue.play(),4800)
 assert.deepEqual(events,['start','write','drain','stop','release'])
})

test('leaving the event before renderer creation finishes prevents late sound playback',async()=>{
 const held=deferred(),events=[];const renderer={start:async()=>events.push('start'),write:async()=>4800,
 drain:async()=>{},stop:async()=>{},release:async()=>events.push('release')}
 const cue=new SoundCue(()=>held.promise);const waiting=cue.play()
 await new Promise(r=>setImmediate(r));await cue.stop();held.resolve(renderer)
 assert.equal(await waiting,0);assert.deepEqual(events,['release'])
})
