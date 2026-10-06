import{j as Ae,k as ze,l as vt,n as kt,g as V,h as Me,B as et,o as Et,G as wt,C as ge,A as be,c as St,a as zt,e as At,f as Mt}from"./puzzle-w_AExPGk.js";import{B as Lt,M as Ct,I as Tt,a as It}from"./three-DtrD1gYx.js";const $t="#";function R(e){const{id:t,name:r,level:s,slices:o,tags:p=[]}=e;if(!t)throw new Error("shape is missing an id");if(!Array.isArray(o)||o.length===0)throw new Error(`shape ${t}: slices must be a non-empty array`);const h=o.length,m=o[0].length,x=o[0][0].length;if(!m||!x)throw new Error(`shape ${t}: slice 0 is empty`);o.forEach((i,d)=>{if(i.length!==m)throw new Error(`shape ${t}: slice ${d} has ${i.length} rows, expected ${m}`);i.forEach((g,u)=>{if(g.length!==x)throw new Error(`shape ${t}: slice ${d} row ${u} is ${g.length} wide, expected ${x}`)})});const f={x,y:m,z:h},a=new Uint8Array(x*m*h);for(let i=0;i<h;i++)for(let d=0;d<m;d++){const g=m-1-d;for(let u=0;u<x;u++)o[i][d][u]===$t&&(a[Ae(f,u,g,i)]=1)}let n=0;for(let i=0;i<a.length;i++)n+=a[i];if(n===0)throw new Error(`shape ${t}: no filled cells`);return{id:t,name:r??t,level:s??1,tags:p,dims:f,cells:a,slices:o}}const Rt=R({id:"l1-flag",name:"깃발",level:1,tags:["non-cubic"],slices:[["###","##.","#.."],["#..","#..","#.."]]}),Nt=R({id:"l1-plus",name:"십자",level:1,tags:["symmetric"],slices:[["...",".#.","..."],[".#.","###",".#."],["...",".#.","..."]]}),Bt=R({id:"l1-mushroom",name:"버섯",level:1,slices:[["###","...","..."],["###",".#.",".#."],["###","...","..."]]}),Ut=R({id:"l1-chair",name:"의자",level:1,slices:[["#..","###","#.#"],["#..","###","..."],["#..","###","#.#"]]}),_t=R({id:"l1-stairs",name:"계단",level:1,slices:[["..#",".##","###"],["..#",".##","###"],["..#",".##","###"]]}),Ot=R({id:"l1-arch",name:"아치",level:1,slices:[["###","#.#","#.#"],["###","#.#","#.#"],["###","#.#","#.#"]]}),Pt=R({id:"l2-tree",name:"나무",level:2,slices:[["....",".##.","....","...."],[".##.","####",".##.",".##."],[".##.","####",".##.",".##."],["....",".##.","....","...."]]}),Dt=R({id:"l2-ladder",name:"사다리",level:2,tags:["non-cubic"],slices:[["#..#","####","#..#","####"],["#..#","####","#..#","####"]]}),qt=R({id:"l2-snowman",name:"눈사람",level:2,slices:[["....","....",".##.",".##."],[".##.",".##.","####","####"],[".##.",".##.","####","####"],["....","....",".##.",".##."]]}),Ft=R({id:"l2-fish",name:"물고기",level:2,tags:["non-cubic"],slices:[["....",".###",".###","...."],["#...","####","####","#..."],["....",".###",".###","...."]]}),Ht=R({id:"l2-mug",name:"컵",level:2,tags:["non-cubic"],slices:[["###.","###.","###.","###."],["#.#.","#.##","#.##","###."],["###.","###.","###.","###."]]}),Gt=R({id:"l2-heart",name:"하트",level:2,slices:[["....",".##.",".##.","...."],["#..#","####","####",".##."],["#..#","####","####",".##."],["....",".##.",".##.","...."]]}),Vt=R({id:"l3-house",name:"집",level:3,tags:["non-cubic"],slices:[["..#..",".###.","#####","#####"],["..#..",".###.","#...#","#...#"],["..#..",".###.","#####","#####"]]}),Yt=R({id:"l3-pyramid",name:"피라미드",level:3,tags:["non-cubic","symmetric"],slices:[[".....",".....","#####"],[".....",".###.","#####"],["..#..",".###.","#####"],[".....",".###.","#####"],[".....",".....","#####"]]}),Wt=R({id:"l3-kettle",name:"주전자",level:3,tags:["non-cubic"],slices:[[".....",".....",".###.",".###.",".###."],["..#..",".###.","#####","#####",".###."],[".....",".....",".###.",".###.",".###."]]}),Xt=R({id:"l3-crown",name:"왕관",level:3,tags:["non-cubic"],slices:[["#...#","#...#","#####","#####"],[".....",".....","#...#","#...#"],["..#..","..#..","#...#","#...#"],[".....",".....","#...#","#...#"],["#...#","#...#","#####","#####"]]}),jt=R({id:"l3-bird",name:"새",level:3,slices:[[".....","..#..",".....",".....","....."],["..#..","#####",".###.","..#..","....."],["..##.","#####",".###.","..#..","..#.."],["..#..","#####",".###.","..#..","....."],[".....","..#..",".....",".....","....."]]}),Kt=R({id:"l3-rocket",name:"로켓",level:3,slices:[[".....",".....",".....",".....","..#.."],[".....","..#..",".###.",".###.",".###."],["..#..",".###.",".###.",".###.","#####"],[".....","..#..",".###.",".###.",".###."],[".....",".....",".....",".....","..#.."]]}),Zt=R({id:"l4-car",name:"자동차",level:4,tags:["non-cubic"],slices:[["......","......","######","######",".#..#."],["..##..",".####.","######","######",".#..#."],["..##..",".####.","######","######",".#..#."],["......","......","######","######",".#..#."]]}),Jt=R({id:"l4-train",name:"기차",level:4,tags:["non-cubic"],slices:[["......","......","######","######",".#.#.#"],["....#.","##....","######","######",".#.#.#"],["....#.","###...","######","######",".#.#.#"],["......","......","######","######",".#.#.#"]]}),Qt=R({id:"l4-dog",name:"강아지",level:4,tags:["non-cubic"],slices:[["......","......",".####.",".####.",".#..#.",".#..#."],["....#.","#...##","#.####",".####.","......","......"],["....#.","#...##","#.####",".####.","......","......"],["......","......",".####.",".####.",".#..#.",".#..#."]]}),en=R({id:"l4-castle",name:"성",level:4,slices:[["##..##","##..##","##..##","######","##..##","##..##"],["##..##","##..##","##..##","##..##","##..##","##..##"],["......","......","......","#....#","#....#","#....#"],["......","......","......","#....#","#....#","#....#"],["##..##","##..##","##..##","##..##","##..##","##..##"],["##..##","##..##","##..##","######","######","######"]]}),tn=R({id:"l4-turtle",name:"거북이",level:4,tags:["non-cubic"],slices:[["......","......",".###..","......","......"],["......",".###..","#####.","#...#.","#...#."],[".###..","#####.","######","......","......"],[".###..","#####.","######","......","......"],["......",".###..","#####.","#...#.","#...#."],["......","......",".###..","......","......"]]}),nn=R({id:"l4-cat",name:"고양이",level:4,slices:[["......","......","......",".####.",".####.",".#..#."],["......","####..","####.#",".#####",".#####",".#..#."],["#.#...","####..","####.#",".#####",".#####",".####."],["#.#...","####..","####.#",".#####",".#####",".####."],["......","####..","####.#",".#####",".#####",".#..#."],["......","......","......",".####.",".####.",".#..#."]]}),Le=[Rt,Nt,Bt,Ut,_t,Ot,Pt,Dt,qt,Ft,Ht,Gt,Vt,Yt,Wt,Xt,jt,Kt,Zt,Jt,Qt,en,tn,nn],sn={1:3,2:4,3:5,4:6},on=[...new Set(Le.map(e=>e.level))].sort((e,t)=>e-t),Ce=on.map(e=>({id:`level-${e}`,name:`Level ${e}`,level:e,box:sn[e],puzzles:Le.filter(t=>t.level===e).map(t=>({id:t.id,name:t.name,level:t.level,dims:t.dims,cells:t.cells,tags:t.tags}))})),rn=e=>e.x*e.y*e.z;function tt(e){return Uint8Array.from(e.cells)}const nt="no-nonogram:",Te=e=>`${nt}${e}`,st=`${nt}@settings`;function an(){try{return globalThis.localStorage??null}catch{return null}}let ot=an();function rt(e){try{const t=ot?.getItem(e);return t?JSON.parse(t):null}catch{return null}}function Ie(e,t){try{ot?.setItem(e,t)}catch{}}function fe(e){return rt(Te(e))}const ln=Object.freeze({solved:!1,elapsedMs:0,mistakes:0,hints:0,hintUses:0,clears:0,best:null}),q=e=>Number.isFinite(e)&&e>=0?Math.floor(e):0;function it(e){return!e||typeof e!="object"||!Number.isFinite(e.ms)||e.ms<0?null:{ms:Math.floor(e.ms),mistakes:q(e.mistakes),hints:q(e.hints),hintUses:q(e.hintUses),at:q(e.at)}}function ne(e){const t=fe(e);return!t||typeof t!="object"?{...ln}:{solved:!!t.solved,elapsedMs:q(t.elapsedMs),mistakes:q(t.mistakes),hints:q(t.hints),hintUses:q(t.hintUses),clears:q(t.clears),best:it(t.best)}}function at(e,t,r){const s={state:e,solved:!!t};return r.elapsedMs&&(s.elapsedMs=r.elapsedMs),r.mistakes&&(s.mistakes=r.mistakes),r.hints&&(s.hints=r.hints),r.hintUses&&(s.hintUses=r.hintUses),r.clears&&(s.clears=r.clears),r.best&&(s.best=r.best),JSON.stringify(s)}function cn(e,t,r){const s=ne(e);Ie(Te(e),at(Array.from(t),r,s))}function dn(e,t={}){const r=fe(e),s=ne(e),o={elapsedMs:"elapsedMs"in t?q(t.elapsedMs):s.elapsedMs,mistakes:"mistakes"in t?q(t.mistakes):s.mistakes,hints:"hints"in t?q(t.hints):s.hints,hintUses:"hintUses"in t?q(t.hintUses):s.hintUses,clears:"clears"in t?q(t.clears):s.clears,best:"best"in t?it(t.best):s.best},p=Array.isArray(r?.state)?r.state:[],h="solved"in t?!!t.solved:s.solved;return Ie(Te(e),at(p,h,o)),{...o,solved:h}}const Be=Object.freeze({muted:!0,reducedMotion:"auto"});function lt(){const e=rt(st);return!e||typeof e!="object"?{...Be}:{muted:typeof e.muted=="boolean"?e.muted:Be.muted,reducedMotion:e.reducedMotion===!0||e.reducedMotion===!1?e.reducedMotion:"auto"}}function un(e={}){const t={...lt(),...e};return Ie(st,JSON.stringify(t)),t}const fn=["cell","solved"];function mn(e){const t=e.dims,r=rn(t),s=tt(e),o=ze(t,s),p=fe(e.id),h=Array.isArray(p?.state)&&p.state.length===r,m=h?Uint8Array.from(p.state):new Uint8Array(r);let x=h?!!p.solved:!1;const f=[];let a=null;const n=new Map(fn.map(z=>[z,new Set]));function i(z,$){for(const N of n.get(z))N($)}const d=()=>Array.from(m,z=>z===V?1:0);let g=0,u=!1;function y(){if(g>0){u=!0;return}cn(e.id,m,x)}function l(){g++}function c(){g=Math.max(0,g-1),!(g>0||!u)&&(u=!1,y())}function k(z,$,{undoable:N=!1}={}){if(N){if(x)return null;m[z]!==$&&(a?a.push({i:z,prev:m[z]}):f.push([{i:z,prev:m[z]}]))}return m[z]=$,i("cell",{i:z,value:$}),!x&&vt(d(),s)&&(x=!0,i("solved")),y(),$}function b(z){return x?null:k(z,(m[z]+1)%kt,{undoable:!0})}function v(){a||(a=[],l())}function M(){if(!a)return 0;const z=a.length;return z>0&&f.push(a),a=null,c(),z}function C(){l(),M();const z=x?null:f.pop();let $=null;if(z)for(let N=z.length-1;N>=0;N--){const{i:E,prev:L}=z[N];k(E,L),$={i:E,value:L}}return c(),$}return{spec:e,dims:t,clues:o,solution:s,state:m,restored:h,get solved(){return x},cycle:b,set:k,beginStroke:v,endStroke:M,undo:C,canUndo:()=>!x&&(f.length>0||a?.length>0),currentRuns:()=>ze(t,d()),on(z,$){return n.get(z)?.add($),()=>n.get(z)?.delete($)},off(z,$){n.get(z)?.delete($)}}}function pn(){const e=[...document.querySelectorAll(".screen")];let t=e.find(r=>!r.hidden)?.id??null;return{show(r){for(const s of e)s.hidden=s.id!==r;t=r},current:()=>t}}const hn={background:"#ecdfc0",voxel:"#2c2417",voxelEdge:"#ecdfc0",frame:"#b6934f"};function gn(e,t,r,s=hn){const o=e.getContext("2d"),p=e.width,h=e.height;o.clearRect(0,0,p,h),o.fillStyle=s.background,o.fillRect(0,0,p,h);const m=Math.min(p,h)/(t.x+t.y+t.z),x=p/2,f=h/2+t.y*m/2,a=[];for(let n=0;n<t.x;n++)for(let i=0;i<t.y;i++)for(let d=0;d<t.z;d++)r[Ae(t,n,i,d)]&&a.push([n,i,d]);a.sort((n,i)=>n[0]+n[2]-n[1]-(i[0]+i[2]-i[1]));for(const[n,i,d]of a){const g=x+(n-d)*m,u=f+(n+d)*m*.5-i*m;o.fillStyle=s.voxel,o.beginPath(),o.moveTo(g,u-m*.5),o.lineTo(g+m,u),o.lineTo(g,u+m*.5),o.lineTo(g-m,u),o.closePath(),o.fill(),o.strokeStyle=s.voxelEdge,o.lineWidth=1,o.stroke()}o.strokeStyle=s.frame,o.lineWidth=2,o.strokeRect(1,1,p-2,h-2)}const Ue=100;function bn({levels:e,getProgress:t,onOpenPuzzle:r,show:s}){const o=document.getElementById("levels-grid"),p=document.getElementById("puzzles-grid"),h=document.getElementById("puzzles-title");let m=null;function x(a){p.innerHTML="",a.puzzles.forEach((n,i)=>{const d=t(n.id),g=n.dims.x*n.dims.y*n.dims.z,u=d?d.state.map(v=>v===V?1:0):new Array(g).fill(0),y=document.createElement("button");y.className="puzzle-card";const l=document.createElement("canvas");l.width=Ue,l.height=Ue,gn(l,n.dims,u),y.appendChild(l);const c=document.createElement("div");c.className="puzzle-name",c.textContent=`#${i+1}`,y.appendChild(c);const k=d?.solved?" puzzle-status--solved":d?" puzzle-status--progress":"",b=document.createElement("div");b.className="puzzle-status"+k,b.textContent=d?.solved?"완료":d?"진행중":"미완료",y.appendChild(b),y.addEventListener("click",()=>r(n)),p.appendChild(y)})}function f(a){m=a,h.textContent=a.name,x(a),s("screen-puzzles")}return{renderLevels(){o.innerHTML="";for(const a of e){const n=document.createElement("button");n.className="level-card",n.innerHTML=`
      <svg class="level-cube-icon" viewBox="0 0 100 116" aria-hidden="true">
        <path d="M50 0 L100 29 L50 58 L0 29 Z" fill="url(#cube-top-grad)" />
        <path d="M0 29 L50 58 L50 116 L0 87 Z" fill="url(#cube-left-grad)" />
        <path d="M100 29 L50 58 L50 116 L100 87 Z" fill="url(#cube-right-grad)" />
      </svg>
      <span class="level-name">${a.name}</span>
    `,n.addEventListener("click",()=>f(a)),o.appendChild(n)}},openLevel:f,reopenCurrentLevel(){m&&f(m)}}}const W=["x","y","z"],xn="(min-width: 980px) and (min-height: 750px)";function yn(){const e={x:document.getElementById("clues-x"),y:document.getElementById("clues-y"),z:document.getElementById("clues-z")},t={x:document.querySelector(".clue-panel--left"),y:document.querySelector(".clue-panel--top"),z:document.querySelector(".clue-panel--right")},r=document.getElementById("clue-tabs"),s={};for(const n of r?.querySelectorAll(".clue-tab")??[])s[n.dataset.axis]=n;const o=window.matchMedia(xn);let p=null,h="x";function m(){for(const n of W){t[n]?.classList.toggle("clue-panel--shown",n===h),t[n]?.classList.toggle("clue-panel--active",n===p);const i=s[n];i&&(i.setAttribute("aria-selected",String(n===h)),i.tabIndex=n===h?0:-1)}}function x(){const n=!o.matches;r?.setAttribute("role",n?"tablist":"presentation");for(const i of W){const d=s[i],g=t[i];d&&g&&(d.setAttribute("role",n?"tab":"button"),d.setAttribute("aria-controls",g.id),g.setAttribute("role",n?"tabpanel":"group"),g.setAttribute("aria-labelledby",n?d.id:""))}}function f(n){!W.includes(n)||n===h||(h=n,m())}for(const n of W)s[n]?.addEventListener("click",()=>f(n)),s[n]?.addEventListener("keydown",i=>{const d={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[i.key];if(!d)return;i.preventDefault();const g=W[(W.indexOf(n)+d+W.length)%W.length];f(g),s[g]?.focus()});const a=()=>{x(),m()};return o.addEventListener("change",a),x(),m(),{render(n,i,d){for(const g of W){const u=e[g];u.innerHTML="";const y=i[g],l=d[g];u.style.gridTemplateColumns=`repeat(${y[0].length}, auto)`,y.forEach((c,k)=>{c.forEach((b,v)=>{const M=l[k][v],C=document.createElement("div");C.className="clue-cell",b.forEach((z,$)=>{const N=document.createElement("span");N.textContent=z,M[$]===z&&(N.className="clue-num--done"),C.appendChild(N)}),u.appendChild(C)})})}},setActiveAxis(n){n!==p&&(p=n,h=n,m())},showAxis:f,shownAxis:()=>h,dispose(){o.removeEventListener("change",a)}}}function vn({onUndo:e}={}){const t=document.getElementById("status"),r=document.getElementById("dims-label"),s=document.getElementById("undo");return e&&s.addEventListener("click",e),{setStatus(o){t.textContent=o},setDims(o){r.textContent=o}}}const kn=.16,U=e=>440*2**(e/12),ie=0,xe=3,ae=7,le=10,_e=15,En=19,ct={fill:[{type:"triangle",freq:U(xe),at:0,dur:.07,gain:1,slideTo:U(ae)}],mark:[{type:"sine",freq:U(ie-12),at:0,dur:.06,gain:.8}],erase:[{type:"sine",freq:U(ie-17),at:0,dur:.05,gain:.55}],mistake:[{type:"sawtooth",freq:U(ie-5),at:0,dur:.09,gain:.35},{type:"sawtooth",freq:U(ie-12),at:.08,dur:.14,gain:.3}],hint:[{type:"triangle",freq:U(ae),at:0,dur:.12,gain:.5,slideTo:U(le)}],reveal:[{type:"triangle",freq:U(le),at:0,dur:.08,gain:.5},{type:"triangle",freq:U(_e),at:.07,dur:.16,gain:.45}],clear:[{type:"triangle",freq:U(xe),at:0,dur:.18,gain:.8},{type:"triangle",freq:U(ae),at:.1,dur:.18,gain:.8},{type:"triangle",freq:U(le),at:.2,dur:.2,gain:.8},{type:"triangle",freq:U(_e),at:.32,dur:.5,gain:.9},{type:"sine",freq:U(En),at:.32,dur:.5,gain:.35}],unlock:[{type:"sine",freq:U(xe),at:0,dur:.3,gain:.6},{type:"sine",freq:U(le),at:.06,dur:.34,gain:.5}],tap:[{type:"sine",freq:U(ae),at:0,dur:.04,gain:.4}]};Object.freeze(Object.keys(ct));function wn({muted:e=!0,onMutedChange:t=null,AudioCtx:r=null}={}){let s=!!e,o=null,p=null;const h=r??globalThis.AudioContext??globalThis.webkitAudioContext??null;function m(){if(!h)return null;if(!o)try{o=new h,p=o.createGain(),p.gain.value=kn,p.connect(o.destination)}catch{return o=null,null}return o.state==="suspended"&&o.resume?.().catch(()=>{}),o}function x(f,a,n){const i=f.createOscillator(),d=f.createGain();i.type=a.type,i.frequency.setValueAtTime(a.freq,n+a.at),a.slideTo&&i.frequency.linearRampToValueAtTime(a.slideTo,n+a.at+a.dur);const g=a.gain??1;d.gain.setValueAtTime(0,n+a.at),d.gain.linearRampToValueAtTime(g,n+a.at+.004),d.gain.exponentialRampToValueAtTime(1e-4,n+a.at+a.dur),i.connect(d).connect(p),i.start(n+a.at),i.stop(n+a.at+a.dur+.02)}return{play(f){if(s)return!1;const a=ct[f];if(!a)return!1;const n=m();if(!n)return!1;try{const i=n.currentTime+.005;for(const d of a)x(n,d,i);return!0}catch{return!1}},muted:()=>s,setMuted(f){const a=!!f;return a===s||(s=a,t?.(s)),s},toggleMuted(){return this.setMuted(!s)},dispose(){try{o?.close?.()}catch{}o=null,p=null}}}const Sn=["change","mistake","cleared"],zn=2e3;function An({session:e,now:t=()=>Date.now(),persist:r=dn}={}){const s=e.spec.id,o=ne(s),p=e.solved;let h=o.elapsedMs,m=!1,x=0,f=o.mistakes,a=o.hints,n=o.hintUses,i=o.best,d=null,g=0,u=null;const y=new Set,l=new Map(Sn.map(S=>[S,new Set])),c=(S,T)=>{for(const P of l.get(S))P(T)},k=()=>m,b=()=>h+(m?Math.max(0,t()-x):0);function v(){g=t(),r(s,{elapsedMs:b(),mistakes:f,hints:a,hintUses:n,best:i,clears:o.clears})}function M(){t()-g>=zn&&v()}function C(){if(u===null)return;const S=u;u=null,!(y.has(S)||e.state[S]!==V)&&(y.add(S),f++,c("mistake",{i:S,mistakes:f}),c("change"),v())}function z({i:S,value:T}){u!==null&&u!==S&&C(),T===V&&!e.solution[S]?u=S:u===S&&(u=null),c("change"),M()}function $(){u=null,E();const S=b(),T=i,P=!T||S<T.ms;P&&(i={ms:S,mistakes:f,hints:a,hintUses:n,at:t()}),o.clears+=1,d={ms:S,mistakes:f,hints:a,hintUses:n,isBest:P,previousBest:T},v(),c("change"),c("cleared",d)}function N(){p||m||(m=!0,x=t(),g=t(),c("change"))}function E(){m&&(h=b(),m=!1,x=0,C(),v(),c("change"))}const L=e.on("cell",z),A=e.on("solved",$);return{puzzleId:s,elapsedMs:b,running:k,mistakes:()=>f,hints:()=>a,hintUses:()=>n,clears:()=>o.clears,best:()=>i,result:()=>d,resume:N,pause:E,noteHint(S=1){return a+=Math.max(0,Math.floor(S)),n+=1,c("change"),v(),{hints:a,hintUses:n}},flush(){C(),v()},on(S,T){return l.get(S)?.add(T),()=>l.get(S)?.delete(T)},dispose(){E(),L(),A();for(const S of l.values())S.clear()}}}function te(e){const t=Math.max(0,Math.floor(e/1e3)),r=t%60,s=Math.floor(t/60)%60,o=Math.floor(t/3600),p=h=>String(h).padStart(2,"0");return o>0?`${o}:${p(s)}:${p(r)}`:`${p(s)}:${p(r)}`}const de=0,X=1,ue=2,Mn=["x","y","z"],Oe=new Map;function me(e){const t=`${e.x}x${e.y}x${e.z}`,r=Oe.get(t);if(r)return r;const s=[],o={x:[e.y,e.z],y:[e.x,e.z],z:[e.x,e.y]};for(const f of Mn){const[a,n]=o[f],i=e[f];for(let d=0;d<a;d++)for(let g=0;g<n;g++){const u=new Int32Array(i);for(let y=0;y<i;y++){const[l,c,k]=f==="x"?[y,d,g]:f==="y"?[d,y,g]:[d,g,y];u[y]=Ae(e,l,c,k)}s.push({id:s.length,axis:f,a:d,b:g,n:i,indices:u})}}const p=e.x*e.y*e.z,h=new Int32Array(p*3).fill(-1),m={x:0,y:1,z:2};for(const f of s)for(const a of f.indices)h[a*3+m[f.axis]]=f.id;const x={dims:e,lines:s,linesByCell:h,total:p};return Oe.set(t,x),x}function dt(e,t){const{lines:r}=me(e);return r.map(s=>t[s.axis][s.a][s.b].filter(p=>p>0))}const Ln=0,Q=-1,D={n:0,k:0,memo:new Int8Array(0),seen:new Uint8Array(0),possFilled:new Uint8Array(0),possEmpty:new Uint8Array(0),filledSuffix:new Uint8Array(0),emptyPrefix:new Int32Array(0),stack:new Int32Array(0)};function Cn(e,t){if(e>D.n&&(D.n=e,D.possFilled=new Uint8Array(e),D.possEmpty=new Uint8Array(e),D.filledSuffix=new Uint8Array(e+1),D.emptyPrefix=new Int32Array(e+2),D.k=-1),t>D.k){D.k=t;const r=(D.n+2)*(t+1);D.memo=new Int8Array(r),D.seen=new Uint8Array(r),D.stack=new Int32Array(r*2)}}function ut(e,t,r){const s=r.length;Cn(t,s);const{memo:o,seen:p,possFilled:h,possEmpty:m,filledSuffix:x,emptyPrefix:f,stack:a}=D,n=s+1;let i=s>0?s-1:0;for(let l=0;l<s;l++)i+=r[l];if(i>t)return Q;x[t]=0;for(let l=t-1;l>=0;l--)x[l]=e[l]===X||x[l+1]?1:0;f[0]=0;for(let l=0;l<t;l++)f[l+1]=f[l]+(e[l]===ue?1:0);const d=(t+2)*n;o.fill(-1,0,d),p.fill(0,0,d),h.fill(0,0,t),m.fill(0,0,t);const g=(l,c)=>{if(l>=t)return c===s;if(c===s)return!x[l];const k=l*n+c;if(o[k]!==-1)return o[k]===1;let b=e[l]!==X&&g(l+1,c);if(!b){const v=r[c],M=l+v;M<=t&&f[M]-f[l]===0&&(M===t||e[M]!==X)&&(b=g(M+1,c+1))}return o[k]=b?1:0,b};if(!g(0,0))return Q;let u=0;for(a[u++]=0,a[u++]=0,p[0]=1;u>0;){const l=a[--u],c=a[--u];if(c>=t)continue;if(l===s){for(let v=c;v<t;v++)m[v]=1;continue}if(e[c]!==X&&g(c+1,l)){m[c]=1;const v=(c+1)*n+l;p[v]||(p[v]=1,a[u++]=c+1,a[u++]=l)}const k=r[l],b=c+k;if(b<=t&&f[b]-f[c]===0&&(b===t||e[b]!==X)&&g(b+1,l+1)){for(let M=c;M<b;M++)h[M]=1;b<t&&(m[b]=1);const v=(b+1)*n+(l+1);p[v]||(p[v]=1,a[u++]=b+1,a[u++]=l+1)}}let y=0;for(let l=0;l<t;l++){const c=h[l],k=m[l];if(!c&&!k)return Q;if(c&&k)continue;const b=c?X:ue;if(e[l]===de)e[l]=b,y++;else if(e[l]!==b)return Q}return y}const ft="ok",Tn="contradiction";function In(e,t,r,s={}){const{lines:o,linesByCell:p,total:h}=me(e),{dirty:m=null}=s,x=new Uint8Array(Math.max(e.x,e.y,e.z)),f=new Uint8Array(o.length);let a=[];if(m)for(const u of m)u>=0&&!f[u]&&(f[u]=1,a.push(u));else for(let u=0;u<o.length;u++)f[u]=1,a.push(u);const n={status:ft,steps:0,rounds:0,sweeps:0,lineSolves:0,determined:0,unknown:0,firstRoundDetermined:0},i=new Int8Array(h).fill(-1);let d=[];const g=()=>(n.status=Tn,n.unknown=Pe(r,h),n);for(;a.length>0;){const u=[];f.fill(0),n.sweeps++;for(const y of a){const l=o[y],{indices:c,n:k}=l;for(let v=0;v<k;v++)x[v]=r[c[v]];n.lineSolves++;const b=ut(x,k,t[y]);if(b===Q)return g();if(b!==Ln){n.steps++;for(let v=0;v<k;v++){const M=c[v];if(r[M]!==x[v]){if(i[M]===-1)i[M]=x[v],d.push(M);else if(i[M]!==x[v])return g()}}}}for(const y of d){r[y]=i[y],i[y]=-1;for(let l=0;l<3;l++){const c=p[y*3+l];c<0||f[c]||(f[c]=1,u.push(c))}}d.length>0&&(n.rounds++,n.determined+=d.length,n.rounds===1&&(n.firstRoundDetermined=d.length)),d=[],a=u}return n.unknown=Pe(r,h),n}function Pe(e,t){let r=0;for(let s=0;s<t;s++)e[s]===de&&r++;return r}function $n(e,t){const{total:r}=me(e),s=dt(e,t),o=new Uint8Array(r),p=In(e,s,o);return{grid:o,stats:p,complete:p.status===ft&&p.unknown===0}}const Rn={steps:1,rounds:4,deferred:20};function Nn(e){const t=e.determined||0,r=t>0?1-e.firstRoundDetermined/t:0,s=Rn,o=s.steps*e.steps+s.rounds*e.rounds+s.deferred*r;return{score:Math.round(o*10)/10,steps:e.steps,rounds:e.rounds,lineSolves:e.lineSolves,deferredRatio:Math.round(r*1e3)/1e3}}function Bn(e,t){const r=t%e.z,s=(t-r)/e.z,o=s%e.y;return[(s-o)/e.y,o,r]}const De=new Map;function ye(e){const t=De.get(e.id);if(t!==void 0)return t;let r=0;try{const s=tt(e),{stats:o}=$n(e.dims,ze(e.dims,s));r=Nn(o).score}catch{r=0}return De.set(e.id,r),r}const qe=Object.freeze({1:1,2:2}),Fe=e=>e===X?V:Me;function Un({session:e,onSpend:t}={}){const{dims:r,solution:s,state:o}=e,{lines:p}=me(r),h=dt(r,e.clues),m=c=>{const[k,b,v]=Bn(r,c);return{x:k,y:b,z:v}};let x=0,f=null,a=0,n=0;function i(){let c=2166136261;for(let k=0;k<o.length;k++)c^=o[k]+k,c=Math.imul(c,16777619);return c>>>0}function d(){const c=new Uint8Array(o.length),k=new Set;for(let b=0;b<o.length;b++){const v=!!s[b];o[b]===V?v?c[b]=X:k.add(b):o[b]===Me&&(v?k.add(b):c[b]=ue)}return{grid:c,wrong:k}}function g(){const{grid:c,wrong:k}=d(),b=new Uint8Array(Math.max(r.x,r.y,r.z)),v=[];for(const M of p){const{indices:C,n:z,id:$}=M;for(let A=0;A<z;A++)b[A]=c[C[A]];const N=ut(b,z,h[$]);if(N===Q||N<=0)continue;const E=[];let L=!1;for(let A=0;A<z;A++){const S=C[A];k.has(S)&&(L=!0),c[S]===de&&b[A]!==de&&E.push({i:S,value:b[A],...m(S)})}E.length!==0&&v.push({line:M,clue:h[$],gains:E.length,cells:E,hasWrong:L})}return v.sort((M,C)=>Number(C.hasWrong)-Number(M.hasWrong)||C.gains-M.gains||M.line.id-C.line.id),v}function u(){for(let c=0;c<o.length;c++)if(!s[c]&&o[c]===V)return{i:c,value:ue,...m(c)};for(let c=0;c<o.length;c++)if(s[c]&&o[c]!==V)return{i:c,value:X,...m(c)};return null}function y(c){a+=1,n+=c,t?.({cost:c,uses:a,points:n})}function l(){if(e.solved)return null;const c=i();c!==f&&(x=0),x=Math.min(x+1,2),f=c;const b=g()[0];if(!b){const C=u();if(!C)return null;x=2;const z=qe[2];return y(z),e.set(C.i,Fe(C.value)),f=i(),{stage:2,cost:z,points:n,uses:a,line:null,clue:null,gains:1,cells:[C],applied:C}}const v={cost:qe[x],line:{id:b.line.id,axis:b.line.axis,a:b.line.a,b:b.line.b,indices:Array.from(b.line.indices)},clue:[...b.clue],gains:b.gains,cells:b.cells};if(x===1)return y(v.cost),{stage:1,...v,points:n,uses:a,applied:null};const M=b.cells.reduce((C,z)=>z.i<C.i?z:C,b.cells[0]);return y(v.cost),e.set(M.i,Fe(M.value)),f=i(),{stage:2,...v,points:n,uses:a,applied:M}}return{next:l,peek:()=>i()===f?Math.min(x+1,2):1,uses:()=>a,points:()=>n,reset(){x=0,f=null}}}function mt(e,t){let r="";for(let s=0;s<t.length;s++)r+=t[s]?"1":"0";return`${e.x}x${e.y}x${e.z}:${r}`}function _n(e){const t=new Map;for(const r of e??[]){if(!r?.dims||!r?.cells)continue;const s=mt(r.dims,r.cells);t.has(s)||t.set(s,r.name??r.id)}return t}function On(e,t,{index:r=null,fallback:s=null}={}){if(e?.name)return{name:e.name,source:"spec"};if(r&&t){const o=r.get(mt(e.dims,t));if(o)return{name:o,source:"catalogue"}}return{name:s??e?.id??"???",source:"fallback"}}const Pn=.5,ce=e=>Math.round(e*10)/10;function He(e,{isSolved:t,scoreFor:r,share:s=Pn}={}){const o=[];let p=!0;for(let h=0;h<e.length;h++){const m=e[h],x=m.puzzles??[];let f=0,a=0,n=0,i=0;for(const u of x){const y=r(u);f+=y,y>i&&(i=y),t(u.id)&&(a+=y,n++)}const d=x.length>=2?f-i:f,g=Math.min(f*s,d);o.push({levelId:m.id,index:h,unlocked:p,cleared:n,puzzleCount:x.length,earned:ce(a),total:ce(f),required:ce(g),remaining:ce(Math.max(0,g-a))}),p=f===0?p:a>=g}return o}const Ge=0,Dn=640,qn=140,Ve=700,Fn=1.5,Hn=.78,Gn="(min-width: 900px)",Vn=.14,Ye=14,_=(e,t,r,s)=>{const o=e.createElement(t);return r&&(o.className=r),s!==void 0&&(o.textContent=s),o};function Yn({doc:e=document,root:t=e.body,sfx:r=null}={}){const s=_(e,"div","fx-clear");s.hidden=!0,s.setAttribute("role","dialog"),s.setAttribute("aria-modal","true"),s.setAttribute("aria-label","퍼즐 완료");const o=_(e,"div","fx-sparks"),p=_(e,"div","fx-card"),h=_(e,"div","fx-card-eyebrow","SOLVED"),m=_(e,"h2","fx-card-name",""),x=_(e,"div","fx-card-sub",""),f=_(e,"div","fx-card-best","🏆 신기록");f.hidden=!0;const a=_(e,"div","fx-card-stats"),n={};for(const[E,L]of[["time","시간"],["mistakes","실수"],["hints","힌트"]]){const A=_(e,"div","fx-card-stat"),S=_(e,"b",null,"-");A.append(S,_(e,"span",null,L)),a.appendChild(A),n[E]=S}const i=_(e,"div","fx-card-prev",""),d=_(e,"div","fx-card-unlock","");d.hidden=!0;const g=_(e,"div","fx-card-actions"),u=_(e,"button","fx-btn","목록으로"),y=_(e,"button","fx-btn fx-btn--primary","다음 퍼즐");g.append(u,y),p.append(h,m,x,f,a,i,d,g),s.append(o,p),t.appendChild(s);const l=[];let c=!1,k={},b=null;const v=(E,L)=>l.push(setTimeout(L,E)),M=()=>{for(const E of l)clearTimeout(E);l.length=0};function C(E){if(o.replaceChildren(),!!E)for(let L=0;L<Ye;L++){const A=_(e,"i"),S=L/Ye*Math.PI*2+(L%2?.22:0),T=150+L%4*46;A.style.setProperty("--dx",`${Math.cos(S)*T}px`),A.style.setProperty("--dy",`${Math.sin(S)*T*.72}px`),A.style.setProperty("--rot",`${(L%2?1:-1)*(180+L*24)}deg`),A.style.animationDelay=`${L%5*70}ms`,o.appendChild(A)}}function z({grid:E,dims:L,solution:A,filledValue:S,motion:T}){const P=[];for(let w=0;w<L.y;w++){const I=[];for(let O=0;O<L.x;O++)for(let H=0;H<L.z;H++){const Y=(O*L.y+w)*L.z+H;A[Y]&&I.push(Y)}I.length&&P.push(I)}const J=w=>{for(const I of w)E.setState(I,S)};if(v(Ge,()=>{for(let w=0;w<A.length;w++)E.setState(w,et);T||P.forEach(J)}),!T)return;const j=Dn/Math.max(1,P.length);P.forEach((w,I)=>{v(Ge+40+j*I,()=>{J(w),r?.play("tap")})})}function $(E,L){if(!E?.controls)return;const{controls:A,camera:S}=E,T={autoRotate:A.autoRotate,speed:A.autoRotateSpeed,position:S?.position.clone(),target:A.target?.clone()};b=()=>{A.autoRotate=T.autoRotate,A.autoRotateSpeed=T.speed,T.position&&S.position.copy(T.position),T.target&&A.target.copy(T.target),A.update?.(),b=null},v(qn,()=>{if(S)if(globalThis.matchMedia?.(Gn).matches)S.position.sub(A.target).multiplyScalar(Hn).add(A.target);else{const j=2*S.position.distanceTo(A.target)*Math.tan(S.fov*Math.PI/360)*Vn;A.target.y-=j,S.position.y-=j}A.update?.(),L&&(A.autoRotate=!0,A.autoRotateSpeed=Fn)})}function N(){c&&(c=!1,M(),b?.(),s.classList.remove("fx-clear--on"),s.hidden=!0,o.replaceChildren(),k={})}return u.addEventListener("click",()=>{r?.play("tap");const E=k.onMenu;N(),E?.()}),y.addEventListener("click",()=>{r?.play("tap");const E=k.onNext;N(),E?.()}),{run(E){M(),c=!0,k={onNext:E.onNext,onMenu:E.onMenu};const L=E.motion!==!1;m.textContent=E.name,x.textContent=E.subtitle??"",n.time.textContent=te(E.result.ms),n.mistakes.textContent=String(E.result.mistakes),n.hints.textContent=String(E.result.hintUses??0),f.hidden=!E.result.isBest;const A=E.result.previousBest;i.textContent=E.result.isBest?A?`이전 최고 ${te(A.ms)}`:"첫 클리어":A?`최고 기록 ${te(A.ms)}`:"",d.hidden=!E.unlocked,d.textContent=E.unlocked?`🔓 ${E.unlocked} 해금!`:"",y.hidden=!E.hasNext,y.textContent="다음 퍼즐",C(L),E.grid&&E.solution&&z({grid:E.grid,dims:E.dims,solution:E.solution,filledValue:E.filledValue,motion:L}),$(E.view,L),r?.play("clear"),E.unlocked&&v(Ve+260,()=>r?.play("unlock")),s.hidden=!1,v(L?Ve:60,()=>{s.classList.add("fx-clear--on"),y.focus?.()})},close:N,isOpen:()=>c,dispose(){N(),s.remove()}}}const We="tag-btn";function Xe(e,t){for(const r of t){const s=e.querySelector(r);if(s)return s}return null}const Z=(e,t,r,s)=>{const o=e.createElement(t);return r&&(o.className=r),s!==void 0&&(o.textContent=s),o};function Wn({doc:e=document,sfx:t=null,onHint:r,onToggleMute:s}={}){const o=Xe(e,["#screen-game .puzzle-info","#screen-game .band--top","#screen-game header"])??e.body,p=Z(e,"span","fx-stat","⏱ 00:00");p.title="경과 시간";const h=Z(e,"span","fx-stat","✖ 0");h.title="실수 — 틀린 칸을 그대로 둔 횟수";const m=Z(e,"span","fx-stat fx-stat--best","");m.title="최고 기록",m.hidden=!0,o.append(p,h,m);const x=Xe(e,["#screen-game .band--bottom","#screen-game footer"])??e.body,f=Z(e,"div","fx-row fx-row--end"),a=Z(e,"button",We,"💡");a.title="힌트",a.setAttribute("aria-label","힌트");const n=Z(e,"button",We,"🔇");n.title="소리 켜기",n.setAttribute("aria-label","소리 켜기"),f.append(a,n),x.appendChild(f);const i=Z(e,"div","fx-banner");i.hidden=!0,i.setAttribute("role","status"),e.body.appendChild(i);const d=Z(e,"div","fx-toast");d.hidden=!0,d.setAttribute("role","status"),e.body.appendChild(d);let g=0,u=0,y=0;return a.addEventListener("click",()=>r?.()),n.addEventListener("click",()=>s?.()),{setTimer(l){p.textContent!==`⏱ ${l}`&&(p.textContent=`⏱ ${l}`)},setMistakes(l,{bump:c=!1}={}){const k=`✖ ${l}`;h.textContent!==k&&(h.textContent=k),h.classList.toggle("fx-stat--alert",l>0),c&&(clearTimeout(y),h.classList.remove("fx-stat--bump"),h.offsetWidth,h.classList.add("fx-stat--bump"),y=setTimeout(()=>h.classList.remove("fx-stat--bump"),400))},setBest(l){m.hidden=!l,m.textContent=l?`🏆 ${l}`:""},setHintStage(l){const c=l===2?"힌트 — 칸 하나 확정 (2점)":"힌트 — 볼 줄 알려주기 (1점)";a.title=c,a.setAttribute("aria-label",c),a.textContent=l===2?"💡!":"💡"},setMuted(l){n.textContent=l?"🔇":"🔈";const c=l?"소리 켜기":"소리 끄기";n.title=c,n.setAttribute("aria-label",c),n.setAttribute("aria-pressed",String(l))},setControlsEnabled(l){a.disabled=!l,a.style.opacity=l?"":"0.4"},banner(l,c=7e3){clearTimeout(g),i.innerHTML=l,i.hidden=!1,requestAnimationFrame(()=>requestAnimationFrame(()=>i.classList.add("fx-banner--on"))),c>0&&(g=setTimeout(()=>this.hideBanner(),c))},hideBanner(){clearTimeout(g),i.classList.remove("fx-banner--on"),g=setTimeout(()=>{i.hidden=!0},250)},toast(l,c=3200){clearTimeout(u),d.textContent=l,d.hidden=!1,t?.play("tap"),requestAnimationFrame(()=>requestAnimationFrame(()=>d.classList.add("fx-toast--on"))),u=setTimeout(()=>{d.classList.remove("fx-toast--on"),u=setTimeout(()=>{d.hidden=!0},250)},c)},dispose(){clearTimeout(g),clearTimeout(u),clearTimeout(y);for(const l of[p,h,m,f,i,d])l.remove()}}}const je=6e3,Xn=1100,ve=1.22;function jn({scene:e,dims:t,gap:r=wt}){const s=Et(t,r),o=new Lt(ge*ve,ge*ve,ge*ve),p=new Ct({color:be.x,transparent:!0,opacity:0,depthWrite:!1}),h=Math.max(t.x,t.y,t.z),m=new Tt(o,p,h);m.count=0,m.frustumCulled=!1,m.renderOrder=2,e.add(m);const x=new It;let f=0,a=!1;function n(){a=!1,f=0,m.count=0,p.opacity=0}return{showLine(i,d="x"){if(n(),!i?.length)return;p.color.set(be[d]??be.x);let g=0;for(const u of i){if(g>=m.instanceMatrix.count)break;x.makeTranslation(s[u*3],s[u*3+1],s[u*3+2]),m.setMatrixAt(g++,x)}m.count=g,m.instanceMatrix.needsUpdate=!0,a=!0,f=0},clear:n,tick(i){if(!a)return;if(f+=i,f>=je){n();return}const d=.18+.22*(.5+.5*Math.sin(f/Xn*Math.PI*2)),g=Math.min(1,(je-f)/900);p.opacity=d*g},dispose(){e.remove(m),m.dispose?.(),o.dispose(),p.dispose()}}}const ke="fx-lock-badge",Ee="fx-locked";function Kn({doc:e=document,levels:t,getUnlocks:r,onBlocked:s}={}){const o=e.getElementById("levels-grid");if(!o)return{refresh(){},dispose(){}};let p=!1,h=[];const m=()=>[...o.children].filter(n=>n.nodeType===1);function x(){if(!p){p=!0;try{h=r?.()??[];const n=m();if(n.length!==t.length)return;n.forEach((i,d)=>{const g=h[d];i.querySelector(`.${ke}`)?.remove();const u=g&&!g.unlocked;if(i.classList.toggle(Ee,!!u),i.dataset.fxLevel=t[d].id,!u){i.removeAttribute("aria-disabled");return}i.setAttribute("aria-disabled","true");const y=h[d-1],l=e.createElement("div");l.className=ke;const c=y&&y.required>0?Math.min(1,y.earned/y.required):0,k=e.createElement("div");k.className="fx-lock-bar";const b=e.createElement("i");b.style.width=`${Math.round(c*100)}%`,k.appendChild(b);const v=e.createElement("span");v.textContent=y?`🔒 ${Math.round(y.earned)} / ${Math.round(y.required)}`:"🔒",l.append(v,k),i.appendChild(l)})}finally{p=!1}}}function f(n){const i=n.target.closest?.("#levels-grid > *");if(!i||!i.classList.contains(Ee))return;n.stopPropagation(),n.preventDefault();const d=m().indexOf(i);s?.({level:t[d],info:h[d],previous:h[d-1]})}o.addEventListener("click",f,!0);const a=new MutationObserver(()=>x());return a.observe(o,{childList:!0}),x(),{refresh:x,dispose(){a.disconnect(),o.removeEventListener("click",f,!0);for(const n of m())n.classList.remove(Ee),n.querySelector(`.${ke}`)?.remove()}}}const Zn=`
.fx-row { display: flex; align-items: center; gap: 0.5rem; }
/* Pushes the hint/mute pair to the far end of the bottom band without touching the
   band's own flex rules. */
.fx-row--end { margin-left: auto; }

/* --- the extra HUD readouts, appended into the existing bands ---------------- */
.fx-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--band-fg, #eee0bd);
  white-space: nowrap;
}
.fx-stat small { opacity: 0.6; font-size: 0.75em; font-weight: 400; }
.fx-stat--alert { color: #e8a08f; }
.fx-stat--best { color: var(--gold, #b6934f); }

/* A mistake landing: one quick nudge, never a layout shift. */
.fx-motion .fx-stat--bump { animation: fx-bump 0.32s ease-out; }
@keyframes fx-bump {
  0%   { transform: none; }
  35%  { transform: translateY(-3px) scale(1.14); }
  100% { transform: none; }
}

/* --- hint banner: sits over the board, never in the layout ------------------- */
/* fixed, not absolute: the UI track's #board carries no positioning context and
   giving it one would be an edit to their layout. Bottom offset clears the 72px
   bottom band plus a margin. */
.fx-banner {
  position: fixed;
  left: 50%;
  bottom: 5.75rem;
  transform: translateX(-50%);
  z-index: 6;
  max-width: min(92%, 32rem);
  padding: 0.6rem 1rem;
  border-radius: 14px;
  border: 1px solid var(--gold, #b6934f);
  background: rgba(20, 16, 13, 0.92);
  color: var(--band-fg, #eee0bd);
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  line-height: 1.45;
  text-align: center;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.fx-banner[hidden] { display: none; }
.fx-banner--on { opacity: 1; }
.fx-motion .fx-banner { transform: translateX(-50%) translateY(6px); }
.fx-motion .fx-banner--on { transform: translateX(-50%) translateY(0); }
.fx-banner b { color: var(--accent, #d9a441); }
.fx-banner .fx-clue {
  display: inline-block;
  margin: 0 0.15rem;
  padding: 0.05rem 0.4rem;
  border-radius: 6px;
  background: rgba(217, 164, 65, 0.18);
  font-variant-numeric: tabular-nums;
}

/* --- toast: unlock news and locked-level refusals ---------------------------- */
.fx-toast {
  position: fixed;
  left: 50%;
  top: 1.25rem;
  transform: translateX(-50%);
  z-index: 40;
  padding: 0.65rem 1.1rem;
  border-radius: 999px;
  border: 1px solid rgba(217, 164, 65, 0.5);
  background: rgba(20, 16, 13, 0.95);
  color: var(--hub-fg, #f2e8d5);
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}
.fx-toast[hidden] { display: none; }
.fx-toast--on { opacity: 1; }
.fx-motion .fx-toast { transform: translateX(-50%) translateY(-8px); }
.fx-motion .fx-toast--on { transform: translateX(-50%) translateY(0); }

/* --- locked level cards ------------------------------------------------------ */
.fx-locked { position: relative; filter: grayscale(0.75) brightness(0.72); cursor: not-allowed; }
.fx-locked:hover { transform: none !important; border-color: rgba(255, 255, 255, 0.08) !important; }
.fx-lock-badge {
  position: absolute;
  inset: auto 0 0.55rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  font-family: system-ui, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--hub-fg, #f2e8d5);
  filter: grayscale(0) brightness(1.5);
}
.fx-lock-bar {
  width: 68%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}
.fx-lock-bar > i { display: block; height: 100%; background: var(--accent, #d9a441); }

/* --- the clear celebration -------------------------------------------------- */
/* Never centred. The shape that just assembled is the point of the whole sequence, and
   a centred card sits exactly on top of it.
   Narrow screens: the card goes to the bottom and the camera lifts the shape above it
   (fx/celebrate.js reads the same breakpoint).
   Wide screens: the card goes beside the shape instead, which is the only layout where
   neither has to give up room — see the media query below.
   The backdrop is a gradient for the same reason: barely tinted over the board, dark
   behind the card so its text keeps contrast. */
.fx-clear {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1.25rem 1.25rem 5.5rem;
  background: linear-gradient(
    180deg,
    rgba(20, 16, 13, 0.06) 0%,
    rgba(20, 16, 13, 0.22) 38%,
    rgba(20, 16, 13, 0.78) 78%
  );
  opacity: 0;
  transition: opacity 0.35s ease;
}

/* Keep this breakpoint in step with SIDE_CARD_QUERY in fx/celebrate.js. */
@media (min-width: 900px) {
  .fx-clear {
    align-items: center;
    justify-content: flex-end;
    padding: 1.5rem 2.5rem 1.5rem 1.5rem;
    background: linear-gradient(
      90deg,
      rgba(20, 16, 13, 0.04) 0%,
      rgba(20, 16, 13, 0.18) 45%,
      rgba(20, 16, 13, 0.72) 82%
    );
  }
}
.fx-clear[hidden] { display: none; }
.fx-clear--on { opacity: 1; }

.fx-card {
  width: min(100%, 23rem);
  padding: 1.6rem 1.5rem 1.25rem;
  border-radius: 22px;
  border: 1px solid var(--gold, #b6934f);
  background: linear-gradient(165deg, #262019, #15110d);
  color: var(--hub-fg, #f2e8d5);
  font-family: system-ui, sans-serif;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.fx-motion .fx-card { animation: fx-card-in 0.42s cubic-bezier(0.16, 0.9, 0.3, 1.1) both; }
@keyframes fx-card-in {
  from { opacity: 0; transform: translateY(18px) scale(0.94); }
  to   { opacity: 1; transform: none; }
}

.fx-card-eyebrow {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent, #d9a441);
}
.fx-card-name {
  margin: 0.5rem 0 0.1rem;
  font-family: var(--font-display, Georgia, serif);
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1.1;
}
.fx-card-sub { font-size: 0.78rem; color: var(--hub-fg-dim, rgba(242, 232, 213, 0.55)); }

.fx-card-best {
  display: inline-block;
  margin-top: 0.7rem;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: rgba(217, 164, 65, 0.16);
  color: var(--accent, #d9a441);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.fx-card-best[hidden] { display: none; }
.fx-motion .fx-card-best { animation: fx-pop 0.5s 0.3s ease-out both; }
@keyframes fx-pop {
  0%   { opacity: 0; transform: scale(0.6); }
  60%  { opacity: 1; transform: scale(1.12); }
  100% { opacity: 1; transform: scale(1); }
}

.fx-card-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 1.15rem 0 0.4rem;
}
.fx-card-stat {
  padding: 0.6rem 0.25rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
}
.fx-card-stat b {
  display: block;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.fx-card-stat span {
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--hub-fg-dim, rgba(242, 232, 213, 0.55));
}
.fx-card-prev {
  min-height: 1.1rem;
  font-size: 0.72rem;
  color: var(--hub-fg-dim, rgba(242, 232, 213, 0.55));
  font-variant-numeric: tabular-nums;
}

.fx-card-unlock {
  margin-top: 0.75rem;
  padding: 0.45rem 0.75rem;
  border-radius: 12px;
  background: rgba(143, 214, 148, 0.14);
  color: #8fd694;
  font-size: 0.8rem;
  font-weight: 700;
}
.fx-card-unlock[hidden] { display: none; }
.fx-motion .fx-card-unlock { animation: fx-pop 0.5s 0.55s ease-out both; }

.fx-card-actions { display: flex; gap: 0.6rem; margin-top: 1.1rem; }
.fx-btn {
  flex: 1;
  padding: 0.75rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--hub-fg, #f2e8d5);
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}
.fx-btn:hover { background: rgba(255, 255, 255, 0.13); }
.fx-btn:active { transform: scale(0.97); }
.fx-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent, #d9a441), var(--accent-deep, #c98f2e));
  color: #241a0c;
}
.fx-btn--primary:hover { filter: brightness(1.08); background: linear-gradient(135deg, var(--accent, #d9a441), var(--accent-deep, #c98f2e)); }

/* Sparkles: pure CSS, only under .fx-motion, and purely decorative. */
.fx-sparks { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.fx-sparks i {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--accent, #d9a441);
  opacity: 0;
}
.fx-motion .fx-sparks i { animation: fx-spark 1.5s ease-out forwards; }
@keyframes fx-spark {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.4) rotate(0deg); }
  12%  { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--rot)); }
}

/* Narrow *and* short: nowhere to put the shape, so centre the card and darken the
   backdrop rather than pretending there is a reveal to look at. */
@media (max-width: 899px) and (max-height: 620px) {
  .fx-clear {
    align-items: center;
    padding: 1rem;
    background: radial-gradient(ellipse at center, rgba(20, 16, 13, 0.45), rgba(20, 16, 13, 0.85));
  }
}

@media (max-width: 480px) {
  .fx-card { padding: 1.3rem 1.1rem 1rem; }
  .fx-card-name { font-size: 1.7rem; }
  .fx-stat { font-size: 0.78rem; }
}
`,Ke="fx-rewards-styles";function Jn(e=document){if(e.getElementById(Ke))return;const t=e.createElement("style");t.id=Ke,t.textContent=Zn,e.head.appendChild(t)}const Qn=500,es={x:"X",y:"Y",z:"Z"},ts={x:(e,t)=>`y=${e}, z=${t}`,y:(e,t)=>`x=${e}, z=${t}`,z:(e,t)=>`x=${e}, y=${t}`};function ns({levels:e,view:t,openPuzzle:r,backToList:s,doc:o=document}={}){Jn(o);const p=_n(Le),h=lt(),m=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"),x=()=>h.reducedMotion===!0?!1:h.reducedMotion===!1?!0:!m?.matches,f=()=>o.documentElement.classList.toggle("fx-motion",x());f(),m?.addEventListener?.("change",f);const a=wn({muted:h.muted,onMutedChange:w=>{h.muted=w,un({muted:w}),i.setMuted(w)}}),n=()=>He(e,{isSolved:w=>ne(w).solved,scoreFor:ye}),i=Wn({doc:o,sfx:a,onHint:()=>z(),onToggleMute:()=>{a.toggleMuted()||a.play("reveal")}});i.setMuted(a.muted());const d=Yn({doc:o,sfx:a}),g=Kn({doc:o,levels:e,getUnlocks:n,onBlocked:({level:w,previous:I})=>{const O=I?Math.max(0,Math.round(I.required-I.earned)):0;i.toast(I?`${w.name} 잠김 — 앞 레벨에서 난이도 ${O}점 더 모으면 열립니다`:`${w.name} 잠김`)}});let u=null,y=null,l=null,c=null,k=null,b=null,v=null;function M({bump:w=!1}={}){if(!l)return;i.setTimer(te(l.elapsedMs())),i.setMistakes(l.mistakes(),{bump:w});const I=l.best();i.setBest(I?te(I.ms):null),i.setHintStage(c?.peek()??1),i.setControlsEnabled(!u?.solved)}const C=setInterval(()=>{l?.running()&&i.setTimer(te(l.elapsedMs()))},Qn);function z(){if(!c||!u||u.solved)return;const w=c.next();if(!w){i.banner("더 알려줄 게 없습니다 — 이미 다 풀렸어요");return}if(w.stage===1){a.play("hint"),k?.showLine(w.line.indices,w.line.axis);const I=ts[w.line.axis](w.line.a,w.line.b),O=w.clue.length?w.clue.join(" "):"0";i.banner(`<b>${es[w.line.axis]}축</b> 줄 (${I}) 을 다시 읽어보세요 · 클루 <span class="fx-clue">${O}</span> · 지금 <b>${w.gains}칸</b>이 결정됩니다`)}else{a.play("reveal"),w.line&&k?.showLine(w.line.indices,w.line.axis);const I=w.applied,O=w.applied.value===1?"블록":"빈 칸";i.banner(`(x, y, z) = (${I.x}, ${I.y}, ${I.z}) 은 <b>${O}</b> 입니다`)}M()}function $({value:w}){a.play(w===V?"fill":w===Me?"mark":"erase"),M()}function N(){a.play("mistake"),M({bump:!0})}function E(w){k?.clear(),i.hideBanner(),i.setControlsEnabled(!1),M();const I=He(e,{isSolved:K=>K===u.spec.id||ne(K).solved,scoreFor:ye}),O=I.find((K,he)=>K.unlocked&&v?.[he]?.unlocked===!1);g.refresh(),v=I;const{spec:H}=u,Y=e.find(K=>K.puzzles.some(he=>he.id===H.id)),re=Y?Y.puzzles.findIndex(K=>K.id===H.id):-1,pe=Y&&re>=0?Y.puzzles[re+1]:null,{name:yt}=On(H,u.solution,{index:p,fallback:Y&&re>=0?`${Y.name} #${re+1}`:H.id});d.run({name:yt,subtitle:`${H.dims.x}×${H.dims.y}×${H.dims.z} · 난이도 ${ye(H)}`,result:w,grid:y,view:t,dims:H.dims,solution:u.solution,filledValue:V,motion:x(),unlocked:O?e[O.index]?.name??null:null,hasNext:!!pe,onNext:()=>pe?r?.(pe):s?.(),onMenu:()=>s?.()})}const L=o.getElementById("screen-game"),A=()=>!!L&&!L.hidden;function S(){if(!l)return;A()&&!o.hidden&&!u?.solved?l.resume():l.pause()}const T=L?new MutationObserver(()=>S()):null;T?.observe(L,{attributes:!0,attributeFilter:["hidden"]});const P=()=>S();o.addEventListener("visibilitychange",P);const J=()=>l?.flush();globalThis.addEventListener?.("pagehide",J);function j(){d.close(),i.hideBanner(),b?.(),b=null,k?.dispose(),k=null,l?.dispose(),l=null,c=null,u=null,y=null}return{openPuzzle({session:w,grid:I}){j(),u=w,y=I,v=n(),l=An({session:u}),c=Un({session:u,onSpend:({cost:O})=>l.noteHint(O)}),t?.scene&&(k=jn({scene:t.scene,dims:u.dims}),b=t.onFrame?.(O=>k?.tick(O))),u.on("cell",$),l.on("mistake",N),l.on("cleared",E),M(),S()},closePuzzle:j,unlocks:n,refreshLocks:()=>g.refresh(),debug:{attempt:()=>l,hint:()=>z(),unlocks:n,solveNow(){if(!u)return!1;for(let w=0;w<u.solution.length;w++)u.set(w,u.solution[w]?V:et);return!0}},dispose(){j(),clearInterval(C),T?.disconnect(),o.removeEventListener("visibilitychange",P),globalThis.removeEventListener?.("pagehide",J),g.dispose(),d.dispose(),i.dispose(),a.dispose()}}}const Ze="Solved! 🎉",$e=document.getElementById("scene"),pt=new URLSearchParams(location.search),we=Number(pt.get("fitmargin")),F=St($e,{...Number.isFinite(we)&&we>0?{fitMargin:we}:{}}),se=zt(F.renderer,{overlay:pt.has("perf")});let B=null,G=null,ee=null,Je=!1;const oe=pn(),ht=yn(),Se=vn({onUndo:()=>B?.undo()}),Re=bn({levels:Ce,getProgress:fe,onOpenPuzzle:gt,show:oe.show}),Ne=ns({levels:Ce,view:F,openPuzzle:gt,backToList:()=>Re.reopenCurrentLevel()});function Qe(){ht.render(B.dims,B.clues,B.currentRuns())}function ss(){Ne.closePuzzle(),G&&(F.scene.remove(G.group),G.dispose(),G=null),ee&&(F.scene.remove(ee.group),ee.dispose(),ee=null)}function gt(e){ss(),B=mn(e),G=At(B.dims),G.setAll(B.state),F.scene.add(G.group),ee=Mt(B.dims),F.scene.add(ee.group),F.frameCamera(B.dims),Se.setDims(`${B.dims.x}×${B.dims.y}×${B.dims.z}`),Se.setStatus(B.solved?Ze:""),Qe(),B.on("cell",({i:t,value:r})=>{G.setState(t,r),Qe()}),B.on("solved",()=>Se.setStatus(Ze)),Ne.openPuzzle({session:B,grid:G}),oe.show("screen-game"),F.resize(),Je||(Je=!0,se.mark("first-puzzle"))}const os=5;let bt=0,xt=0;$e.addEventListener("pointerdown",e=>{bt=e.clientX,xt=e.clientY});$e.addEventListener("pointerup",e=>{if(Math.hypot(e.clientX-bt,e.clientY-xt)>=os||!B||B.solved)return;const t=G.pick(F.rayFrom(e));t!==null&&B.cycle(t)});document.getElementById("btn-start").addEventListener("click",()=>{Re.renderLevels(),oe.show("screen-levels")});document.getElementById("btn-levels-back").addEventListener("click",()=>oe.show("screen-main"));document.getElementById("btn-puzzles-back").addEventListener("click",()=>oe.show("screen-levels"));document.getElementById("btn-game-back").addEventListener("click",()=>Re.reopenCurrentLevel());window.addEventListener("resize",()=>F.resize());F.onFrame(()=>{se.beginFrame(),ht.setActiveAxis(F.facingAxis())});F.onFrameEnd(()=>se.endFrame());F.start();window.__nonogram={perf:()=>se.stats(),perfReset:()=>se.reset(),grid:()=>G?.stats()??null,session:()=>B,levels:()=>Ce.map(e=>({id:e.id,puzzles:e.puzzles.map(t=>({id:t.id,dims:t.dims}))})),rewards:Ne.debug};
