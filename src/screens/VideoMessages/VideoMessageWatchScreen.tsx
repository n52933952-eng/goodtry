import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  BackHandler,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useUser } from '../../context/UserContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useSocket } from '../../context/SocketContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { uploadMediaToR2 } from '../../utils/directR2Upload';
import { mediaDisplayUrl } from '../../utils/mediaUrl';
import { getVideoDurationSeconds } from '../../utils/videoDuration';
import { removeTempVideo, shrinkVideoForMessage } from '../../utils/lightVideo';
import { useShowToast } from '../../hooks/useShowToast';
import { useWideScreenLayout } from '../../utils/responsiveLayout';
import { fmtTime, otherParty, partyLabel, uidOf } from './VideoMessagesScreen';

const REACTIONS = ['❤️', '😂', '🔥', '😮', '😢', '👏', '😍', '🎉', '👍', '💯', '🙏', '😭', '🤣', '😎', '💪', '✨', '😘', '🤔', '😅', '🙌'];

/** Same center for the play dot and a Reply here mark, kept fully on the bar. */
function pinOnBar(t: number, width: number, dur: number) {
  const span = Math.max(1, dur || 1);
  const c = (Number(t) || 0) / span * width;
  return Math.max(8, Math.min(Math.max(8, width - 8), c));
}

function notesPayload(notes: any[]) {
  return (notes || []).map((n) => ({
    id: String(n._id),
    t: Number(n.t) || 0,
    type: n.type,
    url: n.videoUrl ? mediaDisplayUrl(n.videoUrl) : '',
    reaction: n.reaction || '',
    name: n.user?.name || n.user?.username || '',
    onNote: n.onNote ? String(n.onNote) : '',
  }));
}

function playerHtml(src: string, notes: any[], poster = '', knownDuration = 0) {
  const safe = String(src || '').replace(/"/g, '&quot;');
  const known = Number.isFinite(knownDuration) && knownDuration > 0 && knownDuration < 1e5 ? knownDuration : 0;
  const json = JSON.stringify(notesPayload(notes)).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;font-family:-apple-system,system-ui}
#wrap{position:relative;width:100%;height:100%;background:#000;overflow:hidden}
#main,#note{width:100%;height:100%;object-fit:contain;background:#000;display:block}
video::-webkit-media-controls,video::-webkit-media-controls-enclosure,video::-webkit-media-controls-panel,video::-webkit-media-controls-overlay-play-button,video::-webkit-media-controls-start-playback-button,video::-webkit-media-controls-overlay-enclosure{display:none !important;opacity:0 !important;width:0 !important;height:0 !important;pointer-events:none !important;-webkit-appearance:none}
#main,#note{pointer-events:none}
#shield{position:absolute;inset:0;z-index:2;background:transparent}
#dim{display:none}
#card{position:absolute;inset:0;width:100%;height:100%;display:none;background:#000;z-index:4}
#note{background:#000}
#meta{position:absolute;top:10px;left:10px;right:10px;display:flex;justify-content:space-between;align-items:center}
#who,#close{background:rgba(0,0,0,.55);color:#fff;font-size:12px;padding:5px 10px;border-radius:999px}
#react,#reactReply{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:64px;display:none;pointer-events:none;z-index:6}
</style></head><body><div id="wrap">
<video id="main" playsinline webkit-playsinline preload="auto" controlslist="nodownload nofullscreen noremoteplayback noplaybackrate" disablepictureinpicture disableremoteplayback ${poster ? `poster="${String(poster).replace(/"/g, '&quot;')}"` : ''} src="${safe}"></video>
<div id="shield"></div>
<div id="dim"></div>
<div id="react"></div>
<div id="card"><video id="note" playsinline webkit-playsinline preload="auto" controlslist="nodownload nofullscreen noremoteplayback noplaybackrate" disablepictureinpicture disableremoteplayback></video><video id="child" playsinline webkit-playsinline preload="auto" style="display:none;position:absolute;inset:0;z-index:5;width:100%;height:100%;object-fit:contain;background:#000" controlslist="nodownload nofullscreen noremoteplayback noplaybackrate" disablepictureinpicture disableremoteplayback></video><div id="reactReply"></div><div id="meta"><span id="who"></span><span id="close">Close</span></div></div>
</div><script>
var main=document.getElementById('main');
var note=document.getElementById('note');
var child=document.getElementById('child');
main.controls=false;
note.controls=false;
child.controls=false;
main.loop=false;
note.loop=false;
child.loop=false;
main.removeAttribute('controls');
note.removeAttribute('controls');
child.removeAttribute('controls');
document.getElementById('shield').onclick=function(){ window.toggle(); };
var card=document.getElementById('card');
var dim=document.getElementById('dim');
var reactEl=document.getElementById('react');
var reactReply=document.getElementById('reactReply');
var who=document.getElementById('who');
var notes=${json};
var shown={};
var lastT=0;
var overlayOn=false;
var childOn=false;
var childId='';
var childBack=0;
var scrubbing=false;
var pinnedT=0;
var playingId='';
function send(type, extra){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type}, extra||{}))); }
var primedUrl='';
var held=false;
var finishedId='';
var notePlayed=0;
var knownDur=${known};
function finiteDur(){
  var d=main.duration;
  if(isFinite(d)&&d>0&&d<100000) return d;
  return knownDur>0?knownDur:0;
}
function prime(n){
  if(!n||!n.url||primedUrl===n.url) return;
  primedUrl=n.url;
  note.src=n.url;
  note.load();
}
function dismissReply(){
  if(!overlayOn && !playingId && !childOn) return;
  hideChild(false);
  playingId='';
  overlayOn=false;
  try{ note.pause(); }catch(e){}
  note.onended=null;
  note.onloadeddata=null;
  card.style.display='none';
  dim.style.display='none';
  send('overlayEnd');
}
function hideOverlay(resume){
  hideChild(false);
  playingId='';
  note.loop=false;
  try{ note.pause(); }catch(e){}
  note.onended=null;
  note.onloadeddata=null;
  var end=finiteDur();
  var land=end?Math.min(end, pinnedT):pinnedT;
  if(Math.abs((main.currentTime||0)-land)>0.05){
    try{ main.currentTime=land; }catch(e){}
  }
  lastT=land;
  overlayOn=false;
  card.style.display='none';
  dim.style.display='none';
  var atEnd=end && land>=end-0.35;
  send('time',{t:land,d:end,playing:!held && !atEnd});
  if(resume!==false && !held && !atEnd) main.play().catch(function(){});
}
function nextReply(afterT){
  var best=null;
  for(var i=0;i<notes.length;i++){
    var x=notes[i];
    if(x.type!=='video'||!x.url||x.onNote||shown[x.id]) continue;
    if(Math.abs((x.t||0)-afterT)>0.8) continue;
    if(!best||x.t<best.t) best=x;
  }
  return best;
}
function showVideoNote(n, resumeAfter){
  if(!n||!n.url||n.onNote) return;
  if(overlayOn && playingId===n.id) return;
  hideChild(false);
  scrubbing=false;
  held=false;
  overlayOn=true;
  playingId=n.id;
  shown[n.id]=true;
  noteLast=0;
  notes.forEach(function(x){ if(x.onNote===n.id) delete shown[x.id]; });
  send('overlay', {id:n.id});
  pinnedT=(Number(n.t)||0)+0.15;
  try{ main.currentTime=pinnedT; }catch(e){}
  send('time',{t:Number(n.t)||0,d:finiteDur(),playing:false});
  main.pause();
  card.style.display='block';
  who.textContent=(window.replyLabel||'Reply')+(n.name?' · '+n.name:'');
  note.onloadeddata=null;
  note.loop=false;
  notePlayed=0;
  note.onended=function(){
    note.loop=false;
    try{ note.pause(); }catch(e){}
    if(notePlayed<0.2 && (note.currentTime||0)<0.2) return;
    finishedId=n.id;
    var nxt=nextReply(n.t||0);
    if(nxt && nxt.id!==n.id && nxt.url!==n.url){ showVideoNote(nxt, resumeAfter); return; }
    hideOverlay(resumeAfter!==false);
    send('overlayEnd');
  };
  var start=function(){
    note.onloadeddata=null;
    try{ if((note.currentTime||0)>0.05) note.currentTime=0; }catch(e){}
    note.play().catch(function(){});
  };
  if(primedUrl!==n.url || note.readyState<2){
    prime(n);
    if(note.readyState>=2) start();
    else note.onloadeddata=start;
  } else start();
}
function nextChild(parentId, afterT){
  var best=null;
  for(var i=0;i<notes.length;i++){
    var x=notes[i];
    if(x.type!=='video'||!x.url||x.onNote!==parentId||shown[x.id]) continue;
    if(Math.abs((x.t||0)-afterT)>0.8) continue;
    if(!best||x.t<best.t) best=x;
  }
  return best;
}
function hideChild(resume){
  if(!childOn && !childId) return;
  childOn=false;
  childId='';
  send('childEnd');
  try{ child.pause(); }catch(e){}
  child.onended=null;
  child.onloadeddata=null;
  child.style.display='none';
  if(resume && overlayOn && !held){
    try{ note.currentTime=childBack; }catch(e){}
    note.play().catch(function(){});
  }
}
function showChild(n){
  if(!n||!n.url||!overlayOn||n.onNote!==playingId) return;
  held=false;
  childOn=true;
  childId=n.id;
  shown[n.id]=true;
  childBack=note.currentTime||n.t||0;
  try{ note.pause(); }catch(e){}
  child.style.display='block';
  send('childTime',{id:n.id,t:0});
  child.onended=function(){
    try{ child.pause(); }catch(e){}
    if((child.currentTime||0)<0.2) return;
    var nxt=nextChild(playingId, n.t||0);
    if(nxt && nxt.id!==n.id && nxt.url!==n.url){ showChild(nxt); return; }
    hideChild(true);
  };
  var start=function(){
    child.onloadeddata=null;
    try{ if((child.currentTime||0)>0.05) child.currentTime=0; }catch(e){}
    child.play().catch(function(){});
  };
  child.onloadeddata=null;
  if(child.getAttribute('src')!==n.url || child.readyState<2){
    child.src=n.url;
    child.load();
    child.onloadeddata=start;
  } else start();
}
var noteLast=0;
function showReact(n){
  shown[n.id]=true;
  var el=(n.onNote&&overlayOn)?reactReply:reactEl;
  el.textContent=n.reaction||'❤️';
  el.style.display='block';
  setTimeout(function(){ el.style.display='none'; }, 1500);
}
main.addEventListener('timeupdate', function(){
  if(scrubbing) return;
  if(overlayOn||held){
    if(overlayOn && Math.abs((main.currentTime||0)-pinnedT)>0.25){
      try{ main.currentTime=pinnedT; }catch(e){}
    }
    return;
  }
  var t=main.currentTime||0;
  var prev=lastT;
  lastT=t;
  send('time', {t:t,d:finiteDur(),playing:!main.paused});
  if(t+0.05<prev){
    if(prev-t<0.75) return;
    finishedId='';
    notes.forEach(function(n){ if(n.t>t+0.2) delete shown[n.id]; });
    return;
  }
  if(t-prev>2.5) return;
  var upcoming=null;
  var shownReact=false;
  for(var i=0;i<notes.length;i++){
    var n=notes[i];
    if(shown[n.id]||n.onNote) continue;
    var reached=n.t>prev-0.08 && n.t<=t+0.08;
    if(n.type==='video' && n.url && reached){
      if(n.id===finishedId) continue;
      showVideoNote(n, true);
      send('overlay', {id:n.id});
      return;
    }
    if(n.type==='video' && n.url && !upcoming && n.t>t && n.t-t<8) upcoming=n;
    if(!shownReact && n.type==='reaction' && !n.onNote && Math.abs((n.t||0)-t)<=0.22){
      showReact(n);
      shownReact=true;
    }
  }
  // Pre-buffer the next reply ~8s early so it plays the instant its moment arrives.
  if(upcoming) prime(upcoming);
});
main.addEventListener('play', function(){
  if(overlayOn){ try{ main.pause(); }catch(e){} return; }
  send('play');
});
main.addEventListener('pause', function(){ if(!overlayOn) send('pause'); });
note.addEventListener('play', function(){ if(overlayOn) send('play'); });
note.addEventListener('pause', function(){ if(overlayOn) send('pause'); });
document.getElementById('close').onclick=function(){ hideOverlay(true); send('overlayEnd'); };
window.toggle=function(){
  if(held) return;
  if(childOn){
    if(child.paused) child.play().catch(function(){});
    else child.pause();
    return;
  }
  if(overlayOn){
    if(note.paused) note.play().catch(function(){});
    else note.pause();
    return;
  }
  if(main.paused) main.play(); else main.pause();
};
window.hold=function(){ held=true; main.pause(); try{ note.pause(); }catch(e){} try{ child.pause(); }catch(e){} };
window.pauseOnly=function(){ main.pause(); };
window.releasePlay=function(){
  held=false;
  if(childOn){ child.play().catch(function(){}); return; }
  if(overlayOn){ note.play().catch(function(){}); return; }
  main.play().catch(function(){});
};
window.seekTo=function(t, soft){
  t=Math.max(0, Number(t)||0);
  var d=finiteDur();
  if(d&&t>d) t=d;
  var keepPlaying=!main.paused || overlayOn;
  dismissReply();
  scrubbing=!!soft;
  lastT=t;
  if(!soft){
    if(finishedId){
      var done=notes.find(function(x){ return x.id===finishedId; });
      if(!done || (done.t||0)>t+0.25) finishedId='';
    }
    notes.forEach(function(n){
      if(n.onNote) return;
      var nt=n.t||0;
      if(Math.abs(nt-t)<=0.45 || nt>t+0.25) delete shown[n.id];
      else shown[n.id]=true;
    });
  }
  var here=null;
  if(!soft){
    for(var i=0;i<notes.length;i++){
      var n=notes[i];
      if(n.onNote||n.type!=='video'||!n.url) continue;
      if(Math.abs((n.t||0)-t)>0.45) continue;
      if(!here||n.t<here.t) here=n;
    }
  }
  if(soft && typeof main.fastSeek==='function'){
    try { main.fastSeek(t); return; } catch(e){}
  }
  try { main.currentTime=t; } catch(e){}
  if(here){ showVideoNote(here, true); return; }
  var end=finiteDur();
  if(!soft && keepPlaying && !held && !(end && t>=end-0.35)) main.play().catch(function(){});
};
window.openNote=function(id){
  var n=notes.find(function(x){ return x.id===String(id); });
  if(!n) return;
  if(n.type==='video' && n.onNote){
    var parent=notes.find(function(x){ return x.id===n.onNote && !x.onNote; });
    if(parent) showVideoNote(parent, true);
    return;
  }
  main.currentTime=n.t||0;
  if(n.type==='video') showVideoNote(n, true);
  else if(n.type==='reaction') showReact(n);
};
window.playNote=function(raw){
  var n=typeof raw==='string'?JSON.parse(raw):raw;
  if(!n||!n.id) return;
  if(!notes.some(function(x){ return x.id===n.id; })) notes.push(n);
  if(n.type==='reaction'){
    if(n.seek && !overlayOn){
      try { main.currentTime=n.t||0; } catch(e){}
    }
    showReact(n);
    return;
  }
  delete shown[n.id];
  if(n.type==='video' && n.onNote){
    if(overlayOn && playingId===n.onNote){ showChild(n); return; }
    var parent=notes.find(function(x){ return x.id===n.onNote && !x.onNote; });
    if(parent) showVideoNote(parent, true);
    return;
  }
  main.currentTime=n.t||0;
  if(n.type==='video') showVideoNote(n, true);
};
note.addEventListener('timeupdate', function(){
  if(!overlayOn||!playingId) return;
  var t=note.currentTime||0;
  var prev=noteLast;
  noteLast=t;
  if(t>notePlayed) notePlayed=t;
  if((t*4|0)!==(prev*4|0)) send('replyTime',{id:playingId,t:t});
  if(t+0.05<prev){
    notes.forEach(function(n){ if(n.onNote===playingId && n.t>t+0.2) delete shown[n.id]; });
    return;
  }
  if(t-prev>2.5) return;
  var shownReact=false;
  for(var i=0;i<notes.length;i++){
    var n=notes[i];
    if(n.type==='video' && n.url && n.onNote===playingId && !shown[n.id] && !childOn){
      if(n.t>prev-0.08 && n.t<=t+0.08){ showChild(n); return; }
    }
    if(shownReact||n.type!=='reaction'||n.onNote!==playingId||shown[n.id]) continue;
    if(Math.abs((n.t||0)-t)<=0.22){ showReact(n); shownReact=true; }
  }
});
var childLast=0;
child.addEventListener('timeupdate', function(){
  if(!childOn||!childId) return;
  var t=child.currentTime||0;
  if((t*4|0)!==(childLast*4|0)) send('childTime',{id:childId,t:t});
  childLast=t;
});
window.setNotes=function(raw){
  try { notes = typeof raw==='string' ? JSON.parse(raw) : raw; } catch(e) {}
};
var kicked=false;
function kick(){
  if(kicked) return;
  kicked=true;
  main.play().catch(function(){});
}
main.addEventListener('canplay', kick);
main.addEventListener('loadedmetadata', function(){
  var d=finiteDur();
  if(d) send('time',{t:main.currentTime||0,d:d,playing:!main.paused});
});
</script></body></html>`;
}

const VideoMessageWatchScreen = ({ navigation, route }: any) => {
  const id = String(route?.params?.id || '');
  const listPreview = route?.params?.preview;
  const openedFromList = useRef(!!listPreview?.videoUrl);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = useWideScreenLayout();
  const { colors } = useTheme();
  const { user } = useUser();
  const { t, tn, language } = useLanguage();
  const { socket, refreshVideoMessageUnseenCount } = useSocket();
  const showToast = useShowToast();
  const webRef = useRef<WebView>(null);
  const barWidthRef = useRef(220);
  const barWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [barReady, setBarReady] = useState(0);
  const scrubLockRef = useRef(0);
  const lastSeekAtRef = useRef(0);
  const grantXRef = useRef(0);

  const [item, setItem] = useState<any>(listPreview?.videoUrl ? listPreview : null);
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(!listPreview?.videoUrl);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordUploading, setRecordUploading] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [askNow, setAskNow] = useState<any>(null);
  const [reactionNotesOpen, setReactionNotesOpen] = useState(false);
  const [videoFull, setVideoFull] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const other = item ? otherParty(item, user?._id) : null;
  const iAmSender = item ? uidOf(item.sender) === String(user?._id) : false;
  const reactionNotes = notes.filter((n) => n.type === 'reaction');
  const videoNotes = notes.filter((n) => n.type !== 'reaction');
  const notesRef = useRef<any[]>([]);
  const leavingRef = useRef(false);
  const momentRef = useRef(0);
  const replyAtRef = useRef<{ id: string; t: number } | null>(null);
  const childAtRef = useRef<{ id: string; t: number } | null>(null);
  const replyPrevRef = useRef(0);
  const childPrevRef = useRef(0);
  const [layerId, setLayerId] = useState('');
  const askedRef = useRef<Set<string>>(new Set());
  const lastTRef = useRef(0);
  notesRef.current = notes;

  const pushNotesToPlayer = useCallback((list: any[]) => {
    const raw = JSON.stringify(notesPayload(list));
    webRef.current?.injectJavaScript(`window.setNotes(${JSON.stringify(raw)}); true;`);
  }, []);

  const playNoteNow = useCallback((note: any, seek = true) => {
    const packed = notesPayload([note])[0];
    if (!packed) return;
    (packed as any).seek = seek ? 1 : 0;
    webRef.current?.injectJavaScript(`window.playNote(${JSON.stringify(JSON.stringify(packed))}); true;`);
  }, []);
  const compact = width < 380;
  const headerPad = Math.max(insets.top, 8) + (compact ? 8 : 14);
  const playerH = wide.isWide ? 340 : compact ? 210 : 240;
  const chip = Math.round(Math.min(42, Math.max(34, (width - 48) / 8)));
  const pageBg = colors.background;
  const shortSide = Math.min(width, height);
  const fullBtnSize = Math.round(Math.min(48, Math.max(40, shortSide * 0.1)));
  const fullBtnEdge = Math.max(12, Math.round(shortSide * 0.03));
  const fullBtnLeft = Math.max(
    fullBtnEdge,
    Math.min(width - fullBtnSize - fullBtnEdge - insets.right, insets.left + fullBtnEdge),
  );
  const fullBtnBottom = videoFull
    ? insets.bottom + fullBtnEdge
    : fullBtnEdge;

  const load = useCallback(async () => {
    const url = `${ENDPOINTS.VIDEO_MESSAGES}/${id}`;
    try {
      console.log('[video-message] tap open', id);
      const data = await apiService.get(url);
      setItem(data);
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
      refreshVideoMessageUnseenCount?.();
    } catch (e: any) {
      const lastMessage = e?.message || t('vmFailedOpen');
      console.log('[video-message] tap open error', id, lastMessage);
      if (!openedFromList.current) {
        showToast(t('error'), lastMessage, 'error');
        navigation.goBack();
      }
    } finally {
      setLoading(false);
    }
  }, [id, navigation, showToast, refreshVideoMessageUnseenCount, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!videoFull) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setVideoFull(false);
      return true;
    });
    return () => sub.remove();
  }, [videoFull]);

  const paintPlayer = useCallback(() => {
    const top = videoFull ? Math.max(insets.top, 8) + 10 : 10;
    const bg = colors.background;
    const replyWord = t('vmReplyWord').replace(/\\/g, '').replace(/'/g, '');
    const closeWord = t('close').replace(/\\/g, '').replace(/'/g, '');
    webRef.current?.injectJavaScript(`
      var meta=document.getElementById('meta');
      if(meta) meta.style.top='${top}px';
      window.replyLabel='${replyWord}';
      var closeBtn=document.getElementById('close');
      if(closeBtn) closeBtn.textContent='${closeWord}';
      var bg='${bg}';
      document.documentElement.style.background=bg;
      document.body.style.background=bg;
      var wrap=document.getElementById('wrap');
      if(wrap) wrap.style.background=bg;
      var main=document.getElementById('main');
      if(main) main.style.background=bg;
      var note=document.getElementById('note');
      if(note) note.style.background=bg;
      var card=document.getElementById('card');
      if(card) card.style.background=bg;
      true;
    `);
  }, [videoFull, insets.top, colors.background, t]);

  useEffect(() => {
    paintPlayer();
  }, [paintPlayer]);

  useEffect(() => {
    if (!socket) return;
    const onNote = (payload: any) => {
      if (String(payload?.videoMessageId) !== id || !payload?.note) return;
      setNotes((prev) => {
        if (prev.some((n) => String(n._id) === String(payload.note._id))) return prev;
        return [...prev, payload.note].sort((a, b) => a.t - b.t);
      });
    };
    const onDel = (payload: any) => {
      if (String(payload?.videoMessageId) !== id) return;
      setNotes((prev) => prev.filter((n) => String(n._id) !== String(payload.noteId)));
    };
    const onMarker = (payload: any) => {
      if (String(payload?.videoMessageId) !== id || !Array.isArray(payload?.markers)) return;
      setItem((prev: any) => (prev ? { ...prev, markers: payload.markers } : prev));
      const asks = payload.markers.filter((m: any) => m?.type === 'reply');
      const last = asks[asks.length - 1];
      if (!last || last.onNote) {
        if (last) showToast(t('vmAsked'), t('vmWantsReply'), 'info');
        return;
      }
      setAskNow(last);
      showToast(t('vmAsked'), t('vmWantsReply'), 'info');
    };
    socket.on('videoMessage:note', onNote);
    socket.on('videoMessage:noteDeleted', onDel);
    socket.on('videoMessage:marker', onMarker);
    const onDeleted = (payload: any) => {
      if (String(payload?._id) !== id || leavingRef.current) return;
      leavingRef.current = true;
      navigation.goBack();
    };
    socket.on('videoMessage:deleted', onDeleted);
    return () => {
      socket.off('videoMessage:note', onNote);
      socket.off('videoMessage:noteDeleted', onDel);
      socket.off('videoMessage:marker', onMarker);
      socket.off('videoMessage:deleted', onDeleted);
    };
  }, [socket, id, navigation, showToast, t]);

  const playerSource = useMemo(() => {
    if (!item?.videoUrl) return { html: '' };
    const html = playerHtml(
      mediaDisplayUrl(item.videoUrl),
      notes,
      item.thumbnailUrl ? mediaDisplayUrl(item.thumbnailUrl) : '',
      Number(item.duration) || 0,
    );
    return { html };
    // notes are injected after first load so the main video does not reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.videoUrl]);

  useEffect(() => {
    if (!item?.videoUrl) return;
    pushNotesToPlayer(notes);
  }, [notes, item?.videoUrl, pushNotesToPlayer]);

  const serverDur = Number(item?.duration);
  const dur =
    Number.isFinite(serverDur) && serverDur > 0
      ? serverDur
      : Number.isFinite(duration) && duration > 0 && duration < 1e5
        ? duration
        : 1;

  const liveMarker = useMemo(() => {
    const marks: any[] = item?.markers || [];
    return marks.find((m) => !m.onNote && Math.abs((Number(m.t) || 0) - now) < 1.2) || null;
  }, [item?.markers, now]);

  useEffect(() => {
    setAskNow((cur: any) => {
      if (!cur?.onNote) return cur;
      if (String(cur.onNote) === layerId) return cur;
      return null;
    });
  }, [layerId]);

  const deleteNote = async (note: any) => {
    if (!note?._id || busy) return;
    try {
      await apiService.delete(`${ENDPOINTS.VIDEO_MESSAGES}/${id}/notes/${note._id}`);
      setNotes((prev) => prev.filter((n) => String(n._id) !== String(note._id)));
    } catch (e: any) {
      showToast(t('error'), e?.message || t('vmFailedRemove'), 'error');
    }
  };

  const timeAt = (x: number) => {
    const w = Math.max(1, barWidthRef.current);
    return Math.min(dur, Math.max(0, (x / w) * dur));
  };

  const pushSeek = (at: number, soft: boolean) => {
    lastTRef.current = at;
    webRef.current?.injectJavaScript(`window.seekTo(${at}, ${soft ? 'true' : 'false'}); true;`);
  };

  const seekTo = (t: number) => {
    const at = Math.max(0, Math.min(dur || t, Number(t) || 0));
    scrubLockRef.current = Date.now() + 400;
    setNow(at);
    pushSeek(at, false);
  };

  const onScrubGrant = (x: number) => {
    grantXRef.current = x;
    scrubLockRef.current = Date.now() + 1500;
    const at = timeAt(x);
    setNow(at);
    lastTRef.current = at;
  };

  const onScrubMove = (x: number) => {
    scrubLockRef.current = Date.now() + 1500;
    const at = timeAt(x);
    setNow(at);
    lastTRef.current = at;
    const ts = Date.now();
    if (ts - lastSeekAtRef.current < 80) return;
    lastSeekAtRef.current = ts;
    pushSeek(at, true);
  };

  const onScrubRelease = (x: number) => {
    scrubLockRef.current = Date.now() + 450;
    const moved = Math.abs(x - grantXRef.current);
    if (moved < 10) {
      const w = Math.max(1, barWidthRef.current);
      const near = (t: number) => Math.abs((Number(t) / dur) * w - x) < 18;
      const note = notes.find((n) => !n.onNote && near(n.t));
      if (note) {
        playNoteNow(note);
        return;
      }
      const mark = (item?.markers || []).find((m: any) => !m.onNote && near(m.t));
      if (mark) {
        seekTo(Number(mark.t) || 0);
        return;
      }
    }
    const at = timeAt(x);
    setNow(at);
    pushSeek(at, false);
  };

  const askReplyHere = async () => {
    if (busy || !iAmSender) return;
    const target = childAtRef.current || replyAtRef.current;
    const at = target ? target.t : now;
    setBusy(true);
    try {
      const data = await apiService.post(`${ENDPOINTS.VIDEO_MESSAGES}/${id}/reply-prompt`, {
        t: at,
        text: 'Reply here',
        ...(target?.id ? { onNote: target.id } : {}),
      });
      if (Array.isArray(data?.markers)) setItem((prev: any) => (prev ? { ...prev, markers: data.markers } : prev));
      showToast(t('vmSent'), tn('vmAskedAt', { time: fmtTime(at) }), 'success');
    } catch (e: any) {
      showToast(t('error'), e?.message || t('vmFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeReplyHere = async (markT: number, onNote?: string) => {
    if (busy || !iAmSender) return;
    setBusy(true);
    try {
      const data = await apiService.post(`${ENDPOINTS.VIDEO_MESSAGES}/${id}/reply-prompt/remove`, {
        t: markT,
        ...(onNote ? { onNote } : {}),
      });
      if (Array.isArray(data?.markers)) setItem((prev: any) => (prev ? { ...prev, markers: data.markers } : prev));
    } catch (e: any) {
      showToast(t('error'), e?.message || t('vmFailedRemove'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addReaction = async (emoji: string) => {
    if (busy) return;
    const reply = childAtRef.current || replyAtRef.current;
    setBusy(true);
    try {
      const data = await apiService.post(`${ENDPOINTS.VIDEO_MESSAGES}/${id}/notes`, {
        type: 'reaction',
        reaction: emoji,
        t: reply ? reply.t : now,
        ...(reply ? { onNote: reply.id } : {}),
      });
      if (data?.note) {
        setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t));
        playNoteNow(data.note, false);
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('vmFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addVideoNote = async (fromCamera: boolean, onReply?: { id: string; t: number } | null) => {
    if (busy) return;
    try {
      const res = fromCamera
        ? await launchCamera({ mediaType: 'video', videoQuality: 'low', durationLimit: 20, cameraType: 'front' })
        : await launchImageLibrary({ mediaType: 'video', selectionLimit: 1, videoQuality: 'low' });
      if (res.didCancel || !res.assets?.[0]?.uri) {
        webRef.current?.injectJavaScript('window.releasePlay(); true;');
        return;
      }
      const asset = res.assets?.[0];
      const durationSec = getVideoDurationSeconds(asset) || 0;
      if (durationSec > 30) {
        webRef.current?.injectJavaScript('window.releasePlay(); true;');
        Alert.alert(t('error'), t('vmTooLongReply'));
        return;
      }
      if (fromCamera) setRecordUploading(true);
      setBusy(true);
      const lightUri = await shrinkVideoForMessage(asset.uri);
      let videoUrl = '';
      try {
      videoUrl = await uploadMediaToR2(
        {
          uri: lightUri,
          type: 'video/mp4',
          fileName: 'reply.mp4',
          skipCompress: true,
        },
        'video-messages',
      );
      const data = await apiService.post(`${ENDPOINTS.VIDEO_MESSAGES}/${id}/notes`, {
        type: 'video',
        videoUrl,
        duration: Math.round(durationSec),
        t: onReply ? onReply.t : momentRef.current,
        ...(onReply?.id ? { onNote: onReply.id } : {}),
      });
      if (data?.note) {
        setNotes((prev) => [...prev, data.note].sort((a, b) => a.t - b.t));
        playNoteNow(data.note);
        setRecorded(true);
      }
      showToast(t('vmSaved'), tn('vmReplyPinned', { time: fmtTime(momentRef.current) }), 'success');
      } finally {
        await removeTempVideo(lightUri);
      }
    } catch (e: any) {
      webRef.current?.injectJavaScript('window.releasePlay(); true;');
      showToast(t('error'), e?.message || t('vmFailed'), 'error');
    } finally {
      setRecordUploading(false);
      setBusy(false);
    }
  };

  const downloadAll = async () => {
    if (downloading) return;
    setDownloading(true);
    showToast(t('vmDownload'), t('vmPreparing'), 'info');
    try {
      const data = await apiService.get(`${ENDPOINTS.VIDEO_MESSAGES}/${id}/download`);
      if (!data?.url) throw new Error(t('vmCouldNotDownload'));
      await Linking.openURL(String(data.url));
    } catch (e: any) {
      showToast(t('error'), e?.message || t('vmCouldNotDownload'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: headerPad }]}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }
  if (!item) return null;

  return (
    <View style={[styles.screen, { backgroundColor: pageBg, paddingTop: videoFull ? 0 : headerPad }]}>
      <View style={[styles.topBar, wide.contentCap, videoFull && styles.fullHidden]} pointerEvents={videoFull ? 'none' : 'auto'}>
        <View style={styles.barSide}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <View style={styles.backRow}>
              <Text style={[styles.back, { color: colors.text }]}>‹</Text>
              <Text style={[styles.back, { color: colors.text }]}>{t('back')}</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{partyLabel(item, user?._id, { user: t('vmUser'), group: t('vmGroup') })}</Text>
          <Text style={[styles.sub, { color: colors.textGray }]}>{notes.length === 1 ? t('vmReplyOne') : tn('vmRepliesCount', { count: notes.length })}</Text>
        </View>
        <View style={[styles.barSide, styles.barSideEnd]}>
        <TouchableOpacity
          onPress={downloadAll}
          disabled={downloading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.downloadBtn}
          accessibilityLabel={downloading ? t('vmDownloading') : t('vmDownload')}
        >
          {downloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.downloadIcon, { color: colors.text }]}>⬇</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            Alert.alert(t('vmDeleteVideo'), t('vmDeleteBoth'), [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('delete'),
                style: 'destructive',
                onPress: async () => {
                  try {
                    await apiService.delete(`${ENDPOINTS.VIDEO_MESSAGES}/${id}`);
                    if (!leavingRef.current) {
                      leavingRef.current = true;
                      navigation.goBack();
                    }
                  } catch (e: any) {
                    showToast(t('error'), e?.message || t('vmFailedDelete'), 'error');
                  }
                },
              },
            ]);
          }}
        >
          <Text style={[styles.ltrText, { color: '#f87171', fontWeight: '700' }]}>{t('delete')}</Text>
        </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.actions, wide.contentCap, videoFull && styles.fullHidden]} pointerEvents={videoFull ? 'none' : 'auto'}>
        {iAmSender ? (
          <TouchableOpacity
            style={[styles.replyBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
            onPress={askReplyHere}
          >
            <Text style={[styles.replyBtnText, styles.ltrText, { color: colors.text }]} numberOfLines={1}>{t('vmReplyHere')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          disabled={recordUploading}
          style={[styles.replyBtn, styles.recordBtn, { backgroundColor: '#e11d48', borderColor: '#e11d48' }]}
          onPress={() => {
            if (recordUploading) return;
            const onReply = replyAtRef.current;
            momentRef.current = onReply ? onReply.t : now;
            webRef.current?.injectJavaScript('window.hold(); true;');
            addVideoNote(true, onReply);
          }}
        >
          <Text style={[styles.replyBtnText, styles.ltrText, recordUploading && styles.recordLabelHidden]} numberOfLines={1}>
            {recorded ? t('vmRecordAgain') : t('vmRecord')}
          </Text>
          {recordUploading ? (
            <View style={styles.recordSpin} pointerEvents="none">
              <ActivityIndicator color="#fff" size="small" />
            </View>
          ) : null}
        </TouchableOpacity>
        {!iAmSender ? (
          <TouchableOpacity
            style={[styles.replyBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
            onPress={() => {
              const onReply = replyAtRef.current;
              momentRef.current = onReply ? onReply.t : now;
              webRef.current?.injectJavaScript('window.hold(); true;');
              addVideoNote(false, onReply);
            }}
          >
            <Text style={[styles.replyBtnText, styles.ltrText, { color: colors.text }]} numberOfLines={1}>{t('vmGallery')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.replyBtn, { backgroundColor: reactionNotesOpen ? colors.border : colors.cardBg, borderColor: colors.border }]}
          onPress={() => setReactionNotesOpen((open) => !open)}
        >
          <Text style={[styles.replyBtnText, styles.ltrText, { color: colors.text }]} numberOfLines={1}>
            {t('vmReplies')} {(item?.markers || []).filter((m: any) => m.type === 'reply').length + notes.length}
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.player,
          { backgroundColor: pageBg },
          videoFull
            ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, elevation: 40 }
            : { height: playerH },
          videoFull ? null : wide.contentCap,
        ]}
      >
        <WebView
          ref={webRef}
          style={[styles.web, { backgroundColor: pageBg }]}
          originWhitelist={['*']}
          source={playerSource}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          androidLayerType="hardware"
          cacheEnabled
          allowsFullscreenVideo={false}
          setSupportMultipleWindows={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onLoadEnd={() => {
            pushNotesToPlayer(notesRef.current);
            paintPlayer();
          }}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data || '{}');
              if (msg.type === 'time') {
                const t = Number.isFinite(msg.t) ? msg.t : 0;
                if (Date.now() < scrubLockRef.current) {
                  if (Number.isFinite(msg.d) && msg.d > 0 && msg.d < 1e5) setDuration(msg.d);
                  return;
                }
                const prev = lastTRef.current;
                lastTRef.current = t;
                setNow(t);
                if (Number.isFinite(msg.d) && msg.d > 0 && msg.d < 1e5) setDuration(msg.d);
                setPlaying(!!msg.playing);
                if (t + 0.05 < prev) {
                  (item?.markers || []).forEach((m: any) => {
                    if (!m.onNote && m.t > t + 0.2) askedRef.current.delete(`${m.onNote || ''}:${m.t}`);
                  });
                }
                if (!iAmSender && !replyAtRef.current) {
                  const ask = (item?.markers || []).find((m: any) => {
                    if (m?.type !== 'reply' || m.onNote || askedRef.current.has(`:${m.t}`)) return false;
                    return m.t >= Math.min(prev, t) - 0.05 && m.t <= Math.max(prev, t) + 0.35;
                  });
                  if (ask) {
                    askedRef.current.add(`:${ask.t}`);
                    setAskNow(ask);
                  }
                }
              } else if (msg.type === 'play') setPlaying(true);
              else if (msg.type === 'pause') setPlaying(false);
              else if (msg.type === 'replyTime' && msg.id) {
                const rt = Number(msg.t) || 0;
                const rprev = replyPrevRef.current;
                replyPrevRef.current = rt;
                replyAtRef.current = { id: String(msg.id), t: rt };
                if (!childAtRef.current) {
                  const noteId = String(msg.id);
                  setLayerId((cur) => (cur === noteId ? cur : noteId));
                  if (rt + 0.05 < rprev) {
                    (item?.markers || []).forEach((m: any) => {
                      if (String(m.onNote || '') === noteId && m.t > rt + 0.2) askedRef.current.delete(`${m.onNote}:${m.t}`);
                    });
                  } else if (!iAmSender) {
                    const ask = (item?.markers || []).find((m: any) => {
                      if (m?.type !== 'reply' || String(m.onNote || '') !== noteId) return false;
                      if (askedRef.current.has(`${m.onNote}:${m.t}`)) return false;
                      const mt = Number(m.t) || 0;
                      return mt >= Math.min(rprev, rt) - 0.05 && mt <= Math.max(rprev, rt) + 0.35;
                    });
                    if (ask) {
                      askedRef.current.add(`${ask.onNote}:${ask.t}`);
                      setAskNow(ask);
                    }
                  }
                }
              } else if (msg.type === 'childTime' && msg.id) {
                const ct = Number(msg.t) || 0;
                const noteId = String(msg.id);
                if (childAtRef.current?.id !== noteId) childPrevRef.current = 0;
                const cprev = childPrevRef.current;
                childPrevRef.current = ct;
                childAtRef.current = { id: noteId, t: ct };
                setLayerId((cur) => (cur === noteId ? cur : noteId));
                if (!iAmSender && ct + 0.05 >= cprev) {
                  const ask = (item?.markers || []).find((m: any) => {
                    if (m?.type !== 'reply' || String(m.onNote || '') !== noteId) return false;
                    if (askedRef.current.has(`${m.onNote}:${m.t}`)) return false;
                    const mt = Number(m.t) || 0;
                    return mt >= Math.min(cprev, ct) - 0.05 && mt <= Math.max(cprev, ct) + 0.35;
                  });
                  if (ask) {
                    askedRef.current.add(`${ask.onNote}:${ask.t}`);
                    setAskNow(ask);
                  }
                }
              } else if (msg.type === 'childEnd') {
                childAtRef.current = null;
                childPrevRef.current = 0;
                const back = replyAtRef.current;
                setLayerId(back ? back.id : '');
              } else if (msg.type === 'overlayEnd') {
                replyAtRef.current = null;
                childAtRef.current = null;
                replyPrevRef.current = 0;
                childPrevRef.current = 0;
                setLayerId('');
              } else if (msg.type === 'overlay' && msg.id) {
                replyAtRef.current = { id: String(msg.id), t: 0 };
                childAtRef.current = null;
                replyPrevRef.current = 0;
                childPrevRef.current = 0;
                setLayerId(String(msg.id));
              }
            } catch {}
          }}
        />
        {downloading ? (
          <View style={styles.downloadPillWrap} pointerEvents="none">
            <View style={styles.downloadPill}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.downloadPillText} numberOfLines={1}>{t('vmDownloading')}</Text>
            </View>
          </View>
        ) : null}
        <TouchableOpacity
          style={[
            styles.fullBtn,
            {
              left: fullBtnLeft,
              bottom: fullBtnBottom,
              width: fullBtnSize,
              height: fullBtnSize,
              borderRadius: fullBtnSize / 2,
            },
          ]}
          onPress={() => setVideoFull((open) => !open)}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel={videoFull ? t('vmExitFull') : t('vmWatchFull')}
        >
          <Text style={[styles.fullBtnText, { fontSize: Math.round(fullBtnSize * 0.48), lineHeight: Math.round(fullBtnSize * 0.56) }]}>
            {videoFull ? '✕' : '⛶'}
          </Text>
        </TouchableOpacity>
        {!iAmSender && ((!layerId && ((askNow?.type === 'reply' && !askNow?.onNote) || liveMarker?.type === 'reply')) || (layerId && askNow?.type === 'reply' && String(askNow?.onNote || '') === layerId)) ? (
          <View style={styles.askPillWrap} pointerEvents="none">
            <View style={styles.askPill}>
              <Text style={styles.askPillText} numberOfLines={1}>
                {tn('vmAskPill', { time: fmtTime((askNow || liveMarker)?.t) })}
              </Text>
            </View>
          </View>
        ) : null}
        {iAmSender && liveMarker && liveMarker.type !== 'reply' ? (
          <View style={styles.chip} pointerEvents="none">
            <Text style={styles.chipText} numberOfLines={1}>
              {liveMarker.type === 'question' ? `❓ ${liveMarker.text || ''}` : `👀 ${liveMarker.text || t('vmLookHere')}`}
            </Text>
          </View>
        ) : null}
        <Modal
          visible={reactionNotesOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setReactionNotesOpen(false)}
        >
          <View style={styles.centerWrap}>
            <TouchableOpacity style={styles.centerDim} activeOpacity={1} onPress={() => setReactionNotesOpen(false)} />
            <View style={styles.centerCard}>
              <View style={styles.centerHead}>
                <Text style={[styles.centerTitle, styles.ltrText]}>{t('vmReplies')}</Text>
                <TouchableOpacity onPress={() => setReactionNotesOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.sideClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
                {notes.length === 0 && !(item?.markers || []).some((m: any) => m.type === 'reply') ? (
                  <Text style={styles.sideEmpty}>{t('vmNothingYet')}</Text>
                ) : null}
                {(item?.markers || []).some((m: any) => m.type === 'reply') ? (
                  <Text style={[styles.modalLabel, language === 'ar' && styles.modalLabelAr]}>{iAmSender ? t('vmReplyHere') : t('vmAskedYou')}</Text>
                ) : null}
                {(item?.markers || [])
                  .filter((m: any) => m.type === 'reply')
                  .map((m: any, i: number) => (
                    <TouchableOpacity
                      key={`ask-${i}`}
                      style={styles.sideRow}
                      onPress={() => {
                        setReactionNotesOpen(false);
                        if (m.onNote) {
                          const host = notes.find((n) => String(n._id) === String(m.onNote));
                          if (host) {
                            playNoteNow(host);
                            return;
                          }
                        }
                        setAskNow(m);
                        seekTo(Number(m.t) || 0);
                      }}
                    >
                      <Text style={styles.sideTimePill}>{fmtTime(m.t)}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.sideText} numberOfLines={1}>
                          {m.onNote ? tn('vmOnReply', { time: fmtTime(m.t) }) : t('vmReplyOrReaction')}
                        </Text>
                      </View>
                      {iAmSender ? (
                        <TouchableOpacity
                          onPress={() => removeReplyHere(Number(m.t) || 0, m.onNote ? String(m.onNote) : '')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.sideClose}>✕</Text>
                        </TouchableOpacity>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                {videoNotes.length > 0 ? <Text style={[styles.modalLabel, language === 'ar' && styles.modalLabelAr]}>{t('vmReplies')}</Text> : null}
                {videoNotes.map((n) => (
                  <TouchableOpacity
                    key={n._id}
                    style={styles.sideRow}
                    onPress={() => {
                      setReactionNotesOpen(false);
                      playNoteNow(n);
                    }}
                  >
                    <Text style={styles.sideEmoji}>🎥</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.sideText} numberOfLines={1}>
                        {n.user?.name || n.user?.username || t('vmVideoReply')}
                      </Text>
                      <Text style={styles.sideTime}>{fmtTime(n.t)}</Text>
                    </View>
                    {iAmSender || uidOf(n.user) === String(user?._id) ? (
                      <TouchableOpacity onPress={() => deleteNote(n)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.sideClose}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </TouchableOpacity>
                ))}
                {reactionNotes.length > 0 ? <Text style={[styles.modalLabel, language === 'ar' && styles.modalLabelAr]}>{t('vmReactions')}</Text> : null}
                {reactionNotes.map((n) => (
                  <TouchableOpacity
                    key={n._id}
                    style={styles.sideRow}
                    onPress={() => {
                      setReactionNotesOpen(false);
                      if (n.onNote) {
                        const parent = notes.find((x) => String(x._id) === String(n.onNote));
                        if (parent) {
                          playNoteNow(parent);
                          return;
                        }
                      }
                      playNoteNow(n);
                    }}
                  >
                    <Text style={styles.sideEmoji}>{n.reaction || '❤️'}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.sideText} numberOfLines={1}>
                        {n.user?.name || n.user?.username || t('vmReaction')}
                      </Text>
                      <Text style={styles.sideTime}>{n.onNote ? tn('vmOnReply', { time: fmtTime(n.t) }) : fmtTime(n.t)}</Text>
                    </View>
                    {iAmSender || uidOf(n.user) === String(user?._id) ? (
                      <TouchableOpacity onPress={() => deleteNote(n)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.sideClose}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.background, paddingBottom: insets.bottom + 36 }, wide.contentCap]}>
        <View style={styles.timeRow}>
          <TouchableOpacity onPress={() => webRef.current?.injectJavaScript('window.toggle(); true;')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: colors.text, fontSize: 18, width: 28 }}>{playing ? '❚❚' : '▶'}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{fmtTime(now)}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: colors.textGray, fontSize: 13, fontVariant: ['tabular-nums'] }}>{fmtTime(dur)}</Text>
        </View>
        <View
          style={styles.touchPad}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width || 0);
            if (w < 80) return;
            barWidthRef.current = w;
            if (barWaitRef.current) clearTimeout(barWaitRef.current);
            barWaitRef.current = setTimeout(() => setBarReady(w), 140);
          }}
          onStartShouldSetResponderCapture={() => true}
          onMoveShouldSetResponderCapture={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => onScrubGrant(e.nativeEvent.locationX)}
          onResponderMove={(e) => onScrubMove(e.nativeEvent.locationX)}
          onResponderRelease={(e) => onScrubRelease(e.nativeEvent.locationX)}
          onResponderTerminate={(e) => onScrubRelease(e.nativeEvent.locationX)}
        >
          <View style={[styles.bar, { backgroundColor: colors.border }]} pointerEvents="none">
            <View style={[styles.barFill, { width: `${Math.min(100, (now / dur) * 100)}%`, backgroundColor: colors.primary }]} />
            {barReady > 0 ? (
              <View
                style={[styles.knob, { left: pinOnBar(now, barReady, dur) - 8, marginLeft: 0, backgroundColor: colors.primary }]}
              />
            ) : (
              <View
                style={[styles.knob, { left: `${Math.min(100, (now / dur) * 100)}%`, backgroundColor: colors.primary }]}
              />
            )}
            {barReady > 0
              ? (item.markers || []).filter((m: any) => !m.onNote).map((m: any, i: number) => (
                  <View
                    key={`m-${i}`}
                    style={[styles.mark, { left: pinOnBar(Number(m.t) || 0, barReady, dur) - 4, marginLeft: 0 }]}
                  />
                ))
              : null}
            {barReady > 0
              ? notes.filter((n) => !n.onNote).map((n) => (
                  <View
                    key={n._id}
                    style={[
                      styles.noteMark,
                      { left: Math.max(0, Math.min(barReady - 22, pinOnBar(Number(n.t) || 0, barReady, dur) - 11)) },
                    ]}
                  >
                    <Text allowFontScaling={false} style={styles.noteMarkText}>
                      {n.type === 'reaction' ? n.reaction : '🎥'}
                    </Text>
                  </View>
                ))
              : null}
          </View>
        </View>

        <View style={styles.reactRow}>
          {REACTIONS.map((e) => (
            <TouchableOpacity
              key={e}
              style={[
                styles.reactChip,
                { width: chip, height: chip, borderRadius: chip / 2, borderColor: colors.border, backgroundColor: colors.cardBg },
              ]}
              onPress={() => addReaction(e)}
            >
              <Text style={[styles.reactEmoji, { fontSize: compact ? 18 : 20 }]}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
    width: '100%',
  },
  barSide: { flex: 1, minWidth: 96, flexDirection: 'row', alignItems: 'center' },
  barSideEnd: { justifyContent: 'flex-end' },
  downloadBtn: {
    width: 32,
    height: 32,
    marginRight: 10,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  downloadIcon: { fontSize: 16, fontWeight: '700' },
  downloadPillWrap: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    zIndex: 8,
    elevation: 8,
    alignItems: 'center',
  },
  downloadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  downloadPillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, writingDirection: 'ltr' },
  back: { color: '#fff', fontSize: 16, fontWeight: '600', writingDirection: 'ltr' },
  titleBlock: { maxWidth: '46%', alignItems: 'center' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center', writingDirection: 'ltr' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 1, textAlign: 'center', writingDirection: 'ltr' },
  ltrText: { writingDirection: 'ltr' },
  player: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  fullHidden: { opacity: 0 },
  web: { width: '100%', height: '100%', backgroundColor: '#000' },
  chip: {
    position: 'absolute',
    top: 10,
    left: 10,
    maxWidth: '70%',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  centerCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(16,16,16,0.97)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  centerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  centerTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modalLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
    writingDirection: 'ltr',
  },
  modalLabelAr: { letterSpacing: 0, textTransform: 'none' },
  sideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sideEmoji: { fontSize: 22, width: 32, textAlign: 'center' },
  sideTimePill: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 44,
    textAlign: 'center',
    overflow: 'hidden',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    fontVariant: ['tabular-nums'],
  },
  sideTime: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700', marginTop: 2 },
  sideText: { color: '#fff', fontSize: 14, fontWeight: '700', writingDirection: 'ltr', textAlign: 'left' },
  sideClose: { color: 'rgba(255,255,255,0.75)', fontSize: 16, fontWeight: '700' },
  sideEmpty: { color: 'rgba(255,255,255,0.7)', fontSize: 13, paddingVertical: 14, textAlign: 'center' },
  fullBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 50,
    elevation: 50,
  },
  fullBtnText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  askPillWrap: {
    position: 'absolute',
    top: 46,
    left: 12,
    right: 12,
    zIndex: 8,
    elevation: 8,
    alignItems: 'center',
  },
  askPill: {
    maxWidth: '100%',
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  askPillText: { color: '#fff', fontSize: 12, fontWeight: '700', writingDirection: 'ltr' },
  panel: { flex: 1, minHeight: 0, paddingHorizontal: 14, paddingTop: 12, width: '100%' },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  touchPad: { marginHorizontal: 12, paddingVertical: 14, marginBottom: 4 },
  bar: { height: 32, borderRadius: 16, position: 'relative', justifyContent: 'center' },
  barFill: { position: 'absolute', left: 0, top: 13, height: 6, borderRadius: 6 },
  knob: {
    position: 'absolute',
    top: 8,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  mark: {
    position: 'absolute',
    top: 12,
    width: 8,
    height: 8,
    marginLeft: -4,
    backgroundColor: '#facc15',
    borderRadius: 4,
  },
  noteMark: {
    position: 'absolute',
    top: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  noteMarkText: {
    fontSize: 12,
    lineHeight: 16,
    width: 16,
    height: 16,
    textAlign: 'center',
    includeFontPadding: false,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
  reactToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  reactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 4,
    paddingTop: 0,
    paddingHorizontal: 4,
  },
  replyBtn: {
    flexShrink: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  recordBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  recordLabelHidden: { opacity: 0 },
  recordSpin: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13, writingDirection: 'ltr' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
  timeChip: {
    minWidth: 48,
    textAlign: 'center',
    overflow: 'hidden',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  reactChip: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactEmoji: { fontSize: 20 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export default VideoMessageWatchScreen;
