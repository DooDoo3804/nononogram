import{j as Be,k as Ne,l as zt,n as Ct,g as X,r as Tt,B as be,h as ae,o as $t,G as It,C as Le,A as Me,c as Nt,a as Bt,e as Rt,f as _t}from"./puzzle-C0U6cnxr.js";import{B as Ut,M as Pt,I as Ot,a as Dt}from"./three-SpMBVvOe.js";const qt="#";function P(e){const{id:t,name:i,level:s,slices:o,tags:u=[]}=e;if(!t)throw new Error("shape is missing an id");if(!Array.isArray(o)||o.length===0)throw new Error(`shape ${t}: slices must be a non-empty array`);const h=o.length,d=o[0].length,g=o[0][0].length;if(!d||!g)throw new Error(`shape ${t}: slice 0 is empty`);o.forEach((a,f)=>{if(a.length!==d)throw new Error(`shape ${t}: slice ${f} has ${a.length} rows, expected ${d}`);a.forEach((b,m)=>{if(b.length!==g)throw new Error(`shape ${t}: slice ${f} row ${m} is ${b.length} wide, expected ${g}`)})});const p={x:g,y:d,z:h},c=new Uint8Array(g*d*h);for(let a=0;a<h;a++)for(let f=0;f<d;f++){const b=d-1-f;for(let m=0;m<g;m++)o[a][f][m]===qt&&(c[Be(p,m,b,a)]=1)}let r=0;for(let a=0;a<c.length;a++)r+=c[a];if(r===0)throw new Error(`shape ${t}: no filled cells`);return{id:t,name:i??t,level:s??1,tags:u,dims:p,cells:c,slices:o}}const Ft=P({id:"l1-flag",name:"깃발",level:1,tags:["non-cubic"],slices:[["###","##.","#.."],["#..","#..","#.."]]}),Ht=P({id:"l1-plus",name:"십자",level:1,tags:["symmetric"],slices:[["...",".#.","..."],[".#.","###",".#."],["...",".#.","..."]]}),Vt=P({id:"l1-mushroom",name:"버섯",level:1,slices:[["###","...","..."],["###",".#.",".#."],["###","...","..."]]}),Gt=P({id:"l1-chair",name:"의자",level:1,slices:[["#..","###","#.#"],["#..","###","..."],["#..","###","#.#"]]}),Yt=P({id:"l1-stairs",name:"계단",level:1,slices:[["..#",".##","###"],["..#",".##","###"],["..#",".##","###"]]}),Kt=P({id:"l1-arch",name:"아치",level:1,slices:[["###","#.#","#.#"],["###","#.#","#.#"],["###","#.#","#.#"]]}),Wt=P({id:"l2-tree",name:"나무",level:2,slices:[["....",".##.","....","...."],[".##.","####",".##.",".##."],[".##.","####",".##.",".##."],["....",".##.","....","...."]]}),Xt=P({id:"l2-ladder",name:"사다리",level:2,tags:["non-cubic"],slices:[["#..#","####","#..#","####"],["#..#","####","#..#","####"]]}),jt=P({id:"l2-snowman",name:"눈사람",level:2,slices:[["....","....",".##.",".##."],[".##.",".##.","####","####"],[".##.",".##.","####","####"],["....","....",".##.",".##."]]}),Zt=P({id:"l2-fish",name:"물고기",level:2,tags:["non-cubic"],slices:[["....",".###",".###","...."],["#...","####","####","#..."],["....",".###",".###","...."]]}),Jt=P({id:"l2-mug",name:"컵",level:2,tags:["non-cubic"],slices:[["###.","###.","###.","###."],["#.#.","#.##","#.##","###."],["###.","###.","###.","###."]]}),Qt=P({id:"l2-heart",name:"하트",level:2,slices:[["....",".##.",".##.","...."],["#..#","####","####",".##."],["#..#","####","####",".##."],["....",".##.",".##.","...."]]}),en=P({id:"l3-house",name:"집",level:3,tags:["non-cubic"],slices:[["..#..",".###.","#####","#####"],["..#..",".###.","#...#","#...#"],["..#..",".###.","#####","#####"]]}),tn=P({id:"l3-pyramid",name:"피라미드",level:3,tags:["non-cubic","symmetric"],slices:[[".....",".....","#####"],[".....",".###.","#####"],["..#..",".###.","#####"],[".....",".###.","#####"],[".....",".....","#####"]]}),nn=P({id:"l3-kettle",name:"주전자",level:3,tags:["non-cubic"],slices:[[".....",".....",".###.",".###.",".###."],["..#..",".###.","#####","#####",".###."],[".....",".....",".###.",".###.",".###."]]}),sn=P({id:"l3-crown",name:"왕관",level:3,tags:["non-cubic"],slices:[["..#..","#.#.#","#####","#####"],[".....",".....","#...#","#...#"],["#...#","#...#","#...#","#...#"],[".....",".....","#...#","#...#"],["..#..","#.#.#","#####","#####"]]}),on=P({id:"l3-bird",name:"새",level:3,slices:[[".....","..#..",".....",".....","....."],["..#..","#####",".###.","..#..","....."],["..##.","#####",".###.","..#..","..#.."],["..#..","#####",".###.","..#..","....."],[".....","..#..",".....",".....","....."]]}),rn=P({id:"l3-rocket",name:"로켓",level:3,slices:[[".....",".....",".....",".....","..#.."],[".....","..#..",".###.",".###.",".###."],["..#..",".###.",".###.",".###.","#####"],[".....","..#..",".###.",".###.",".###."],[".....",".....",".....",".....","..#.."]]}),an=P({id:"l4-car",name:"자동차",level:4,tags:["non-cubic"],slices:[["......","......","######","######",".#..#."],["..##..",".####.","######","######",".#..#."],["..##..",".####.","######","######",".#..#."],["......","......","######","######",".#..#."]]}),ln=P({id:"l4-train",name:"기차",level:4,tags:["non-cubic"],slices:[["......","......","######","######",".#.#.#"],["....#.","##..#.","######","######",".#.#.#"],["....#.","###.#.","######","######",".#.#.#"],["......","......","######","######",".#.#.#"]]}),cn=P({id:"l4-dog",name:"강아지",level:4,tags:["non-cubic"],slices:[["......","......",".####.",".####.",".#..#.",".#..#."],["....#.","#...##","######",".####.","......","......"],["....#.","#...##","######",".####.","......","......"],["......","......",".####.",".####.",".#..#.",".#..#."]]}),un=P({id:"l4-castle",name:"성",level:4,slices:[["##..##","##..##","##..##","######","##..##","##..##"],["##..##","##..##","##..##","##..##","##..##","##..##"],["......","......","......","#....#","#....#","#....#"],["......","......","......","#....#","#....#","#....#"],["##..##","##..##","##..##","##..##","##..##","##..##"],["##..##","##..##","##..##","######","######","######"]]}),dn=P({id:"l4-turtle",name:"거북이",level:4,tags:["non-cubic"],slices:[["......","......",".###..","......","......"],["......",".###..","#####.","#...#.","#...#."],[".###..","#####.","######","......","......"],[".###..","#####.","######","......","......"],["......",".###..","#####.","#...#.","#...#."],["......","......",".###..","......","......"]]}),fn=P({id:"l4-cat",name:"고양이",level:4,slices:[["......","......","......",".####.",".####.",".#..#."],["......","####..","####.#",".#####",".#####",".#..#."],["#.#...","####..","####.#",".#####",".#####",".####."],["#.#...","####..","####.#",".#####",".#####",".####."],["......","####..","####.#",".#####",".#####",".#..#."],["......","......","......",".####.",".####.",".#..#."]]}),Re=[Ft,Ht,Vt,Gt,Yt,Kt,Wt,Xt,jt,Zt,Jt,Qt,en,tn,nn,sn,on,rn,an,ln,cn,un,dn,fn],mn={1:3,2:4,3:5,4:6},pn=[...new Set(Re.map(e=>e.level))].sort((e,t)=>e-t),_e=pn.map(e=>({id:`level-${e}`,name:`Level ${e}`,level:e,box:mn[e],puzzles:Re.filter(t=>t.level===e).map(t=>({id:t.id,name:t.name,level:t.level,dims:t.dims,cells:t.cells,tags:t.tags}))})),hn=e=>e.x*e.y*e.z;function ct(e){return Uint8Array.from(e.cells)}const ut="no-nonogram:",Ue=e=>`${ut}${e}`,dt=`${ut}@settings`;function gn(){try{return globalThis.localStorage??null}catch{return null}}let ft=gn();function mt(e){try{const t=ft?.getItem(e);return t?JSON.parse(t):null}catch{return null}}function Pe(e,t){try{ft?.setItem(e,t)}catch{}}function ve(e){return mt(Ue(e))}const bn=Object.freeze({solved:!1,elapsedMs:0,mistakes:0,hints:0,hintUses:0,clears:0,best:null}),W=e=>Number.isFinite(e)&&e>=0?Math.floor(e):0;function pt(e){return!e||typeof e!="object"||!Number.isFinite(e.ms)||e.ms<0?null:{ms:Math.floor(e.ms),mistakes:W(e.mistakes),hints:W(e.hints),hintUses:W(e.hintUses),at:W(e.at)}}function le(e){const t=ve(e);return!t||typeof t!="object"?{...bn}:{solved:!!t.solved,elapsedMs:W(t.elapsedMs),mistakes:W(t.mistakes),hints:W(t.hints),hintUses:W(t.hintUses),clears:W(t.clears),best:pt(t.best)}}function ht(e,t,i){const s={state:e,solved:!!t};return i.elapsedMs&&(s.elapsedMs=i.elapsedMs),i.mistakes&&(s.mistakes=i.mistakes),i.hints&&(s.hints=i.hints),i.hintUses&&(s.hintUses=i.hintUses),i.clears&&(s.clears=i.clears),i.best&&(s.best=i.best),JSON.stringify(s)}function xn(e,t,i){const s=le(e);Pe(Ue(e),ht(Array.from(t),i,s))}function yn(e,t={}){const i=ve(e),s=le(e),o={elapsedMs:"elapsedMs"in t?W(t.elapsedMs):s.elapsedMs,mistakes:"mistakes"in t?W(t.mistakes):s.mistakes,hints:"hints"in t?W(t.hints):s.hints,hintUses:"hintUses"in t?W(t.hintUses):s.hintUses,clears:"clears"in t?W(t.clears):s.clears,best:"best"in t?pt(t.best):s.best},u=Array.isArray(i?.state)?i.state:[],h="solved"in t?!!t.solved:s.solved;return Pe(Ue(e),ht(u,h,o)),{...o,solved:h}}const He=Object.freeze({muted:!0,reducedMotion:"auto"});function gt(){const e=mt(dt);return!e||typeof e!="object"?{...He}:{muted:typeof e.muted=="boolean"?e.muted:He.muted,reducedMotion:e.reducedMotion===!0||e.reducedMotion===!1?e.reducedMotion:"auto"}}function vn(e={}){const t={...gt(),...e};return Pe(dt,JSON.stringify(t)),t}const En=["cell","solved"];function kn(e){const t=e.dims,i=hn(t),s=ct(e),o=Ne(t,s),u=ve(e.id),h=Array.isArray(u?.state)&&u.state.length===i,d=h?Uint8Array.from(u.state):new Uint8Array(i);let g=h?!!u.solved:!1;const p=[];let c=null;const r=new Map(En.map(S=>[S,new Set]));function a(S,N){for(const R of r.get(S))R(N)}const f=()=>Array.from(d,S=>S===X?1:0);let b=0,m=!1;function v(){if(b>0){m=!0;return}xn(e.id,d,g)}function n(){b++}function l(){b=Math.max(0,b-1),!(b>0||!m)&&(m=!1,v())}function k(S,N,{undoable:R=!1}={}){if(R){if(g)return null;d[S]!==N&&(c?c.push({i:S,prev:d[S]}):p.push([{i:S,prev:d[S]}]))}return d[S]=N,a("cell",{i:S,value:N}),!g&&zt(f(),s)&&(g=!0,a("solved")),v(),N}function x(S){return g?null:k(S,(d[S]+1)%Ct,{undoable:!0})}function E(){c||(c=[],n())}function C(){if(!c)return 0;const S=c.length;return S>0&&p.push(c),c=null,l(),S}function $(){n(),C();const S=g?null:p.pop();let N=null;if(S)for(let R=S.length-1;R>=0;R--){const{i:L,prev:T}=S[R];k(L,T),N={i:L,value:T}}return l(),N}return{spec:e,dims:t,clues:o,solution:s,state:d,restored:h,get solved(){return g},cycle:x,set:k,beginStroke:E,endStroke:C,undo:$,canUndo:()=>!g&&(p.length>0||c?.length>0),currentRuns:()=>Ne(t,f()),on(S,N){return r.get(S)?.add(N),()=>r.get(S)?.delete(N)},off(S,N){r.get(S)?.delete(N)}}}function wn(e,{axis:t,sign:i}={},s=0){const o=e?.[t];if(!Number.isFinite(o)||o<1)return null;const u=Math.max(0,Math.min(o-1,Math.trunc(Number(s))||0));return u===0?null:i<0?{axis:t,from:0,to:o-1-u}:{axis:t,from:u,to:o-1}}function Ln({view:e,getGrid:t,keyTarget:i=globalThis.window??null}={}){let s=0,o="x",u=-1,h=null;function d(){const n=t?.()??null;return n!==h&&(h=n,s=0),n}const g=(n,l=o)=>Math.max(0,(n.dims[l]??1)-1);function p(){const n=e?.facing?.();return n?.axis?n:null}function c(){return s===0&&p()||{axis:o,sign:u}}function r(){const n=p();return!n||n.axis===o&&n.sign===u?!1:(o=n.axis,u=n.sign,s=0,!0)}function a(n){return n.setLayerWindow(wn(n.dims,{axis:o,sign:u},s)),s}function f(n){const l=d();return l?(r(),s=Math.max(0,Math.min(g(l),Math.trunc(Number(n))||0)),a(l)):0}function b(n){const l=d();return l?(r(),s=Math.max(0,Math.min(g(l),s+(Math.trunc(Number(n))||0))),a(l)):0}function m(){const n=d();return s=0,n?a(n):0}function v(n){if(!(n.metaKey||n.ctrlKey||n.altKey)){if(n.key==="]")b(1);else if(n.key==="[")b(-1);else if(n.key==="\\")m();else return;n.preventDefault()}}return i?.addEventListener?.("keydown",v),{depth:()=>s,step:b,setDepth:f,reset:m,state(){const n=d(),l=c();return{depth:s,axis:l.axis,sign:l.sign,max:n?g(n,l.axis):0,window:n?.layerWindow?.()??null}},dispose(){i?.removeEventListener?.("keydown",v)}}}function Mn(){const e=[...document.querySelectorAll(".screen")];let t=e.find(i=>!i.hidden)?.id??null;return{show(i){for(const s of e)s.hidden=s.id!==i;t=i},current:()=>t}}const Sn={background:"#ecdfc0",voxel:"#2c2417",voxelEdge:"#ecdfc0",frame:"#b6934f"},An=.92;function zn(e,t,i,s=An){const o=e.x+e.z,u=(e.x+e.z-2)/2+e.y,h=Math.min(t*s/o,i*s/u);return{s:h,cx:t/2-(e.x-e.z)*h/2,cy:i/2-((e.x+e.z-2)/2-(e.y-1))*h/2}}function Cn(e,t,i,s=Sn){const o=e.getContext("2d"),u=e.width,h=e.height;o.clearRect(0,0,u,h),o.fillStyle=s.background,o.fillRect(0,0,u,h);const{s:d,cx:g,cy:p}=zn(t,u,h),c=[];for(let r=0;r<t.x;r++)for(let a=0;a<t.y;a++)for(let f=0;f<t.z;f++)i[Be(t,r,a,f)]&&c.push([r,a,f]);c.sort((r,a)=>r[0]+r[2]-r[1]-(a[0]+a[2]-a[1]));for(const[r,a,f]of c){const b=g+(r-f)*d,m=p+(r+f)*d*.5-a*d;o.fillStyle=s.voxel,o.beginPath(),o.moveTo(b,m-d*.5),o.lineTo(b+d,m),o.lineTo(b,m+d*.5),o.lineTo(b-d,m),o.closePath(),o.fill(),o.strokeStyle=s.voxelEdge,o.lineWidth=1,o.stroke()}o.strokeStyle=s.frame,o.lineWidth=2,o.strokeRect(1,1,u-2,h-2)}const Tn=100;function $n(e,t=Tn,i=globalThis.devicePixelRatio){const s=Tt(i);return e.width=Math.round(t*s),e.height=Math.round(t*s),e.style.width=`${t}px`,e.style.height=`${t}px`,s}function In({levels:e,getProgress:t,onOpenPuzzle:i,show:s}){const o=document.getElementById("levels-grid"),u=document.getElementById("puzzles-grid"),h=document.getElementById("puzzles-title");let d=null;function g(c){u.innerHTML="",c.puzzles.forEach((r,a)=>{const f=t(r.id),b=r.dims.x*r.dims.y*r.dims.z,m=f?f.state.map(E=>E===X?1:0):new Array(b).fill(0),v=document.createElement("button");v.className="puzzle-card";const n=document.createElement("canvas");$n(n),Cn(n,r.dims,m),v.appendChild(n);const l=document.createElement("div");l.className="puzzle-name",l.textContent=`#${a+1}`,v.appendChild(l);const k=f?.solved?" puzzle-status--solved":f?" puzzle-status--progress":"",x=document.createElement("div");x.className="puzzle-status"+k,x.textContent=f?.solved?"완료":f?"진행중":"미완료",v.appendChild(x),v.addEventListener("click",()=>i(r)),u.appendChild(v)})}function p(c){d=c,h.textContent=c.name,g(c),s("screen-puzzles")}return{renderLevels(){o.innerHTML="";for(const c of e){const r=document.createElement("button");r.className="level-card",r.innerHTML=`
      <svg class="level-cube-icon" viewBox="0 0 100 116" aria-hidden="true">
        <path d="M50 0 L100 29 L50 58 L0 29 Z" fill="url(#cube-top-grad)" />
        <path d="M0 29 L50 58 L50 116 L0 87 Z" fill="url(#cube-left-grad)" />
        <path d="M100 29 L50 58 L50 116 L100 87 Z" fill="url(#cube-right-grad)" />
      </svg>
      <span class="level-name">${c.name}</span>
    `,r.addEventListener("click",()=>p(c)),o.appendChild(r)}},openLevel:p,reopenCurrentLevel(){d&&p(d)}}}const J=["x","y","z"],Nn="(min-width: 980px) and (min-height: 750px)";function Bn(){const e={x:document.getElementById("clues-x"),y:document.getElementById("clues-y"),z:document.getElementById("clues-z")},t={x:document.querySelector(".clue-panel--left"),y:document.querySelector(".clue-panel--top"),z:document.querySelector(".clue-panel--right")},i=document.getElementById("clue-tabs"),s={};for(const r of i?.querySelectorAll(".clue-tab")??[])s[r.dataset.axis]=r;const o=window.matchMedia(Nn);let u=null,h="x";function d(){for(const r of J){t[r]?.classList.toggle("clue-panel--shown",r===h),t[r]?.classList.toggle("clue-panel--active",r===u);const a=s[r];a&&(a.setAttribute("aria-selected",String(r===h)),a.tabIndex=r===h?0:-1)}}function g(){const r=!o.matches;i?.setAttribute("role",r?"tablist":"presentation");for(const a of J){const f=s[a],b=t[a];f&&b&&(f.setAttribute("role",r?"tab":"button"),f.setAttribute("aria-controls",b.id),b.setAttribute("role",r?"tabpanel":"group"),b.setAttribute("aria-labelledby",r?f.id:""))}}function p(r){!J.includes(r)||r===h||(h=r,d())}for(const r of J)s[r]?.addEventListener("click",()=>p(r)),s[r]?.addEventListener("keydown",a=>{const f={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[a.key];if(!f)return;a.preventDefault();const b=J[(J.indexOf(r)+f+J.length)%J.length];p(b),s[b]?.focus()});const c=()=>{g(),d()};return o.addEventListener("change",c),g(),d(),{render(r,a,f){for(const b of J){const m=e[b];m.innerHTML="";const v=a[b],n=f[b];m.style.gridTemplateColumns=`repeat(${v[0].length}, auto)`,v.forEach((l,k)=>{l.forEach((x,E)=>{const C=n[k][E],$=document.createElement("div");$.className="clue-cell",x.forEach((S,N)=>{const R=document.createElement("span");R.textContent=S,C[N]===S&&(R.className="clue-num--done"),$.appendChild(R)}),m.appendChild($)})})}},setActiveAxis(r){r!==u&&(u=r,h=r,d())},showAxis:p,shownAxis:()=>h,dispose(){o.removeEventListener("change",c)}}}const Ve={rotate:"회전",paint:"칠하기"},Rn={rotate:"✥",paint:"✎"};function _n({onUndo:e,onToggleMode:t}={}){const i=document.getElementById("status"),s=document.getElementById("dims-label"),o=document.getElementById("undo"),u=document.getElementById("btn-mode"),h=u?.querySelector(".mode-btn__text"),d=u?.querySelector(".mode-btn__icon");return e&&o.addEventListener("click",e),t&&u?.addEventListener("click",t),{setStatus(g){i.textContent=g,i.closest(".band")?.classList.toggle("band--solved",!!g)},setDims(g){s.textContent=g},setMode(g,{transient:p=!1}={}){u&&(u.setAttribute("aria-pressed",String(g==="paint")),u.setAttribute("aria-label",`${Ve[g]} 모드${p?" (Shift 누르는 동안)":""}. 누르면 전환`),h&&(h.textContent=Ve[g]),d&&(d.textContent=Rn[g]))}}}const Se=8,Un=450;function Pn(e){navigator.vibrate&&navigator.vibrate(e)}function On({canvas:e,view:t,getSession:i,getGrid:s,onModeChange:o}={}){const u=e.closest("#board")??e.parentElement;let h="rotate",d=!1,g=null,p=0,c=0,r=0,a=0,f=!1,b=!1,m=null;const v=new Set;function n(){return d?h==="paint"?"rotate":"paint":h}function l(){t.controls.enableRotate=n()==="rotate",u?.setAttribute("data-mode",n())}function k(z){const O=s();return O?O.pick(t.rayFrom(z)):null}function x(){const z=i();return z&&!z.solved?z:null}function E(){m!==null&&i()?.endStroke(),m=null,v.clear(),u?.removeAttribute("data-painting")}function C(){clearTimeout(a),a=0,g=null,f=!1,E()}function $(z){if(g!==null){b=!0,clearTimeout(a),f=!0,E();return}g=z.pointerId,b=!1,f=!1,r=0,p=z.clientX,c=z.clientY;const O=x();if(O){if(n()==="paint"){const _=k(z);_!==null&&(m=O.state[_]===X?be:X,O.beginStroke(),O.set(_,m,{undoable:!0}),v.add(_),f=!0,u?.setAttribute("data-painting","1"))}a=setTimeout(()=>{if(a=0,f||b||r>=Se)return;const _=x();if(!_)return;const w=k(z);w!==null&&(_.set(w,_.state[w]===ae?be:ae,{undoable:!0}),f=!0,Pn(15))},Un)}}function S(z){if(z.pointerId!==g||(r=Math.max(r,Math.hypot(z.clientX-p,z.clientY-c)),r>=Se&&a&&(clearTimeout(a),a=0),m===null||b))return;const O=x();if(!O)return;const _=k(z);_!==null&&!v.has(_)&&(O.set(_,m,{undoable:!0}),v.add(_))}function N(z){if(z.pointerId!==g)return;if(clearTimeout(a),a=0,!f&&!b&&r<Se){const _=x(),w=_?k(z):null;w!==null&&_.cycle(w)}C()}function R(z){z.pointerId===g&&C()}function L(z){return h=z==="paint"?"paint":"rotate",l(),o?.(n(),{transient:!1}),n()}function T(z){if(z.key==="Shift"&&!d){d=!0,g===null&&l(),o?.(n(),{transient:!0});return}if((z.key==="p"||z.key==="P")&&!z.metaKey&&!z.ctrlKey&&!z.altKey){if(g!==null)return;L(h==="paint"?"rotate":"paint")}}function A(z){z.key==="Shift"&&d&&(d=!1,g===null&&l(),o?.(n(),{transient:!0}))}function M(z){z.preventDefault()}function I(){d&&(d=!1,l(),o?.(n(),{transient:!0}))}return e.addEventListener("pointerdown",$),e.addEventListener("pointermove",S),e.addEventListener("pointerup",N),e.addEventListener("pointercancel",R),e.addEventListener("contextmenu",M),window.addEventListener("keydown",T),window.addEventListener("keyup",A),window.addEventListener("blur",I),l(),{mode:()=>n(),setMode:L,toggleMode(){return L(h==="paint"?"rotate":"paint")},dispose(){C(),e.removeEventListener("pointerdown",$),e.removeEventListener("pointermove",S),e.removeEventListener("pointerup",N),e.removeEventListener("pointercancel",R),e.removeEventListener("contextmenu",M),window.removeEventListener("keydown",T),window.removeEventListener("keyup",A),window.removeEventListener("blur",I)}}}const Dn=3,bt="no-nonogram:@coach",ne=100,fe={x:"X",y:"Y",z:"Z"};function qn(e){try{const t=e?.getItem?.(bt);return t?!!JSON.parse(t)?.peel:!1}catch{return!1}}function Ge(e){try{e?.setItem?.(bt,JSON.stringify({peel:!0}))}catch{}}function Fn({doc:e=globalThis.document,peel:t,view:i,getDims:s,storage:o=globalThis.localStorage??null}={}){const u=y=>e?.getElementById?.(y)??null,h=u("peel"),d=u("peel-less"),g=u("peel-more"),p=u("peel-readout"),c=u("peel-dot"),r=u("peel-axis"),a=u("peel-depth"),f=u("peel-next"),b=u("peel-next-dot"),m=u("peel-next-axis"),v=u("peel-live"),n=u("peel-coach"),l=u("peel-coach-close");let k=qn(o),x=ne,E=null,C=null,$=null;const S=(y,U)=>Math.max(0,(y?.[U]??0)-1);function N(){const y=t?.state?.()??{depth:0,axis:"x",sign:-1,max:0},U=s?.()??null,F=i?.facing?.()??null,ke=!!F&&(F.axis!==y.axis||F.sign!==y.sign),Z=F?.axis??y.axis,te=y.depth>0?y.axis:Z,we=y.depth>0?y.max:U?S(U,te):y.max,de=y.depth>0&&ke?Z:null;return{depth:y.depth,axis:te,max:we,pending:de,pendingMax:de?S(U,de):we,canMore:!!de||y.depth<we,canLess:y.depth>0}}function R(y){const U=fe[y.axis]??"?",F=y.pending?fe[y.pending]??"?":null;return{more:F?`${F}축으로 옮겨 한 겹 벗기기 (])`:"한 겹 벗기기 (])",less:F?`${F}축으로 옮기고 전체 보기 ([)`:"한 겹 덮기 ([)",reset:y.depth>0?`전체 보기 (\\) — 지금 ${U}축 ${y.depth}겹 벗김`:"벗긴 겹 없음",live:y.depth>0?`${U}축 ${y.depth}겹 벗김${F?`, 다음 조작은 ${F}축`:""}`:`전체 보기, 다음 조작은 ${U}축`}}function L(y){const U=R(y);c&&(c.className=`axis-dot axis-dot--${y.axis}`),r&&(r.textContent=fe[y.axis]??"?"),a&&(a.textContent=`${y.depth}/${y.max}`),f&&(f.style.visibility=y.pending?"visible":"hidden"),y.pending&&(b&&(b.className=`axis-dot axis-dot--${y.pending}`),m&&(m.textContent=fe[y.pending]??"?")),h&&(h.dataset.peeled=y.depth>0?"1":"0"),g&&(g.disabled=!y.canMore,g.title=U.more,g.setAttribute("aria-label",U.more)),d&&(d.disabled=!y.canLess,d.title=U.less,d.setAttribute("aria-label",U.less)),p&&(p.disabled=y.depth===0,p.title=U.reset,p.setAttribute("aria-label",U.reset));const F=y.depth>0?`${y.axis}/${y.depth}`:"0";v&&F!==C&&(C=F,v.textContent=U.live)}function T(y=ne){return x+=Number.isFinite(y)?y:ne,x<ne?$:(x=0,A())}function A(){const y=N(),U=`${y.depth}/${y.max}/${y.axis}/${y.pending??"-"}/${y.canMore}/${y.canLess}`;return U===E||(E=U,$=y,L(y)),y}function M(){!n||n.hidden||(n.classList.remove("peel-coach--on"),n.hidden=!0,h&&delete h.dataset.coach,k=!0,Ge(o))}function I(){if(!n)return!1;n.hidden=!1,h&&(h.dataset.coach="1");const y=e?.defaultView?.requestAnimationFrame??globalThis.requestAnimationFrame;return y?y(()=>y(()=>n.classList.add("peel-coach--on"))):n.classList.add("peel-coach--on"),!0}function z(y){return x=ne,A(),k||!y||(y.level??0)<Dn?!1:(k=!0,Ge(o),I())}function O(y){return U=>{U?.preventDefault?.(),y(),M(),x=ne,A()}}const _=O(()=>t?.step?.(1)),w=O(()=>t?.step?.(-1)),B=O(()=>t?.reset?.()),D=O(()=>{});function G(y){y.key==="Escape"&&M()}return g?.addEventListener?.("click",_),d?.addEventListener?.("click",w),p?.addEventListener?.("click",B),l?.addEventListener?.("click",D),e?.defaultView?.addEventListener?.("keydown",G),A(),{sync:T,openPuzzle:z,dismiss:M,teach(){return I()},model:()=>$??N(),dispose(){g?.removeEventListener?.("click",_),d?.removeEventListener?.("click",w),p?.removeEventListener?.("click",B),l?.removeEventListener?.("click",D),e?.defaultView?.removeEventListener?.("keydown",G)}}}const Hn=.16,H=e=>440*2**(e/12),me=0,Ae=3,pe=7,he=10,Ye=15,Vn=19,xt={fill:[{type:"triangle",freq:H(Ae),at:0,dur:.07,gain:1,slideTo:H(pe)}],mark:[{type:"sine",freq:H(me-12),at:0,dur:.06,gain:.8}],erase:[{type:"sine",freq:H(me-17),at:0,dur:.05,gain:.55}],mistake:[{type:"sawtooth",freq:H(me-5),at:0,dur:.09,gain:.35},{type:"sawtooth",freq:H(me-12),at:.08,dur:.14,gain:.3}],hint:[{type:"triangle",freq:H(pe),at:0,dur:.12,gain:.5,slideTo:H(he)}],reveal:[{type:"triangle",freq:H(he),at:0,dur:.08,gain:.5},{type:"triangle",freq:H(Ye),at:.07,dur:.16,gain:.45}],clear:[{type:"triangle",freq:H(Ae),at:0,dur:.18,gain:.8},{type:"triangle",freq:H(pe),at:.1,dur:.18,gain:.8},{type:"triangle",freq:H(he),at:.2,dur:.2,gain:.8},{type:"triangle",freq:H(Ye),at:.32,dur:.5,gain:.9},{type:"sine",freq:H(Vn),at:.32,dur:.5,gain:.35}],unlock:[{type:"sine",freq:H(Ae),at:0,dur:.3,gain:.6},{type:"sine",freq:H(he),at:.06,dur:.34,gain:.5}],tap:[{type:"sine",freq:H(pe),at:0,dur:.04,gain:.4}]};Object.freeze(Object.keys(xt));function Gn({muted:e=!0,onMutedChange:t=null,AudioCtx:i=null}={}){let s=!!e,o=null,u=null;const h=i??globalThis.AudioContext??globalThis.webkitAudioContext??null;function d(){if(!h)return null;if(!o)try{o=new h,u=o.createGain(),u.gain.value=Hn,u.connect(o.destination)}catch{return o=null,null}return o.state==="suspended"&&o.resume?.().catch(()=>{}),o}function g(p,c,r){const a=p.createOscillator(),f=p.createGain();a.type=c.type,a.frequency.setValueAtTime(c.freq,r+c.at),c.slideTo&&a.frequency.linearRampToValueAtTime(c.slideTo,r+c.at+c.dur);const b=c.gain??1;f.gain.setValueAtTime(0,r+c.at),f.gain.linearRampToValueAtTime(b,r+c.at+.004),f.gain.exponentialRampToValueAtTime(1e-4,r+c.at+c.dur),a.connect(f).connect(u),a.start(r+c.at),a.stop(r+c.at+c.dur+.02)}return{play(p){if(s)return!1;const c=xt[p];if(!c)return!1;const r=d();if(!r)return!1;try{const a=r.currentTime+.005;for(const f of c)g(r,f,a);return!0}catch{return!1}},muted:()=>s,setMuted(p){const c=!!p;return c===s||(s=c,t?.(s)),s},toggleMuted(){return this.setMuted(!s)},dispose(){try{o?.close?.()}catch{}o=null,u=null}}}const Yn=["change","mistake","cleared"],Kn=2e3;function Wn({session:e,now:t=()=>Date.now(),persist:i=yn}={}){const s=e.spec.id,o=le(s),u=e.solved;let h=o.elapsedMs,d=!1,g=0,p=o.mistakes,c=o.hints,r=o.hintUses,a=o.best,f=null,b=0,m=null;const v=new Set,n=new Map(Yn.map(M=>[M,new Set])),l=(M,I)=>{for(const z of n.get(M))z(I)},k=()=>d,x=()=>h+(d?Math.max(0,t()-g):0);function E(){b=t(),i(s,{elapsedMs:x(),mistakes:p,hints:c,hintUses:r,best:a,clears:o.clears})}function C(){t()-b>=Kn&&E()}function $(){if(m===null)return;const M=m;m=null,!(v.has(M)||e.state[M]!==X)&&(v.add(M),p++,l("mistake",{i:M,mistakes:p}),l("change"),E())}function S({i:M,value:I}){m!==null&&m!==M&&$(),I===X&&!e.solution[M]?m=M:m===M&&(m=null),l("change"),C()}function N(){m=null,L();const M=x(),I=a,z=!I||M<I.ms;z&&(a={ms:M,mistakes:p,hints:c,hintUses:r,at:t()}),o.clears+=1,f={ms:M,mistakes:p,hints:c,hintUses:r,isBest:z,previousBest:I},E(),l("change"),l("cleared",f)}function R(){u||d||(d=!0,g=t(),b=t(),l("change"))}function L(){d&&(h=x(),d=!1,g=0,$(),E(),l("change"))}const T=e.on("cell",S),A=e.on("solved",N);return{puzzleId:s,elapsedMs:x,running:k,mistakes:()=>p,hints:()=>c,hintUses:()=>r,clears:()=>o.clears,best:()=>a,result:()=>f,resume:R,pause:L,noteHint(M=1){return c+=Math.max(0,Math.floor(M)),r+=1,l("change"),E(),{hints:c,hintUses:r}},flush(){$(),E()},on(M,I){return n.get(M)?.add(I),()=>n.get(M)?.delete(I)},dispose(){L(),T(),A();for(const M of n.values())M.clear()}}}function re(e){const t=Math.max(0,Math.floor(e/1e3)),i=t%60,s=Math.floor(t/60)%60,o=Math.floor(t/3600),u=h=>String(h).padStart(2,"0");return o>0?`${o}:${u(s)}:${u(i)}`:`${u(s)}:${u(i)}`}const xe=0,Q=1,ye=2,Xn=["x","y","z"],Ke=new Map;function Ee(e){const t=`${e.x}x${e.y}x${e.z}`,i=Ke.get(t);if(i)return i;const s=[],o={x:[e.y,e.z],y:[e.x,e.z],z:[e.x,e.y]};for(const p of Xn){const[c,r]=o[p],a=e[p];for(let f=0;f<c;f++)for(let b=0;b<r;b++){const m=new Int32Array(a);for(let v=0;v<a;v++){const[n,l,k]=p==="x"?[v,f,b]:p==="y"?[f,v,b]:[f,b,v];m[v]=Be(e,n,l,k)}s.push({id:s.length,axis:p,a:f,b,n:a,indices:m})}}const u=e.x*e.y*e.z,h=new Int32Array(u*3).fill(-1),d={x:0,y:1,z:2};for(const p of s)for(const c of p.indices)h[c*3+d[p.axis]]=p.id;const g={dims:e,lines:s,linesByCell:h,total:u};return Ke.set(t,g),g}function yt(e,t){const{lines:i}=Ee(e);return i.map(s=>t[s.axis][s.a][s.b].filter(u=>u>0))}const jn=0,se=-1,K={n:0,k:0,memo:new Int8Array(0),seen:new Uint8Array(0),possFilled:new Uint8Array(0),possEmpty:new Uint8Array(0),filledSuffix:new Uint8Array(0),emptyPrefix:new Int32Array(0),stack:new Int32Array(0)};function Zn(e,t){if(e>K.n&&(K.n=e,K.possFilled=new Uint8Array(e),K.possEmpty=new Uint8Array(e),K.filledSuffix=new Uint8Array(e+1),K.emptyPrefix=new Int32Array(e+2),K.k=-1),t>K.k){K.k=t;const i=(K.n+2)*(t+1);K.memo=new Int8Array(i),K.seen=new Uint8Array(i),K.stack=new Int32Array(i*2)}}function vt(e,t,i){const s=i.length;Zn(t,s);const{memo:o,seen:u,possFilled:h,possEmpty:d,filledSuffix:g,emptyPrefix:p,stack:c}=K,r=s+1;let a=s>0?s-1:0;for(let n=0;n<s;n++)a+=i[n];if(a>t)return se;g[t]=0;for(let n=t-1;n>=0;n--)g[n]=e[n]===Q||g[n+1]?1:0;p[0]=0;for(let n=0;n<t;n++)p[n+1]=p[n]+(e[n]===ye?1:0);const f=(t+2)*r;o.fill(-1,0,f),u.fill(0,0,f),h.fill(0,0,t),d.fill(0,0,t);const b=(n,l)=>{if(n>=t)return l===s;if(l===s)return!g[n];const k=n*r+l;if(o[k]!==-1)return o[k]===1;let x=e[n]!==Q&&b(n+1,l);if(!x){const E=i[l],C=n+E;C<=t&&p[C]-p[n]===0&&(C===t||e[C]!==Q)&&(x=b(C+1,l+1))}return o[k]=x?1:0,x};if(!b(0,0))return se;let m=0;for(c[m++]=0,c[m++]=0,u[0]=1;m>0;){const n=c[--m],l=c[--m];if(l>=t)continue;if(n===s){for(let E=l;E<t;E++)d[E]=1;continue}if(e[l]!==Q&&b(l+1,n)){d[l]=1;const E=(l+1)*r+n;u[E]||(u[E]=1,c[m++]=l+1,c[m++]=n)}const k=i[n],x=l+k;if(x<=t&&p[x]-p[l]===0&&(x===t||e[x]!==Q)&&b(x+1,n+1)){for(let C=l;C<x;C++)h[C]=1;x<t&&(d[x]=1);const E=(x+1)*r+(n+1);u[E]||(u[E]=1,c[m++]=x+1,c[m++]=n+1)}}let v=0;for(let n=0;n<t;n++){const l=h[n],k=d[n];if(!l&&!k)return se;if(l&&k)continue;const x=l?Q:ye;if(e[n]===xe)e[n]=x,v++;else if(e[n]!==x)return se}return v}const Et="ok",Jn="contradiction";function Qn(e,t,i,s={}){const{lines:o,linesByCell:u,total:h}=Ee(e),{dirty:d=null}=s,g=new Uint8Array(Math.max(e.x,e.y,e.z)),p=new Uint8Array(o.length);let c=[];if(d)for(const m of d)m>=0&&!p[m]&&(p[m]=1,c.push(m));else for(let m=0;m<o.length;m++)p[m]=1,c.push(m);const r={status:Et,steps:0,rounds:0,sweeps:0,lineSolves:0,determined:0,unknown:0,firstRoundDetermined:0},a=new Int8Array(h).fill(-1);let f=[];const b=()=>(r.status=Jn,r.unknown=We(i,h),r);for(;c.length>0;){const m=[];p.fill(0),r.sweeps++;for(const v of c){const n=o[v],{indices:l,n:k}=n;for(let E=0;E<k;E++)g[E]=i[l[E]];r.lineSolves++;const x=vt(g,k,t[v]);if(x===se)return b();if(x!==jn){r.steps++;for(let E=0;E<k;E++){const C=l[E];if(i[C]!==g[E]){if(a[C]===-1)a[C]=g[E],f.push(C);else if(a[C]!==g[E])return b()}}}}for(const v of f){i[v]=a[v],a[v]=-1;for(let n=0;n<3;n++){const l=u[v*3+n];l<0||p[l]||(p[l]=1,m.push(l))}}f.length>0&&(r.rounds++,r.determined+=f.length,r.rounds===1&&(r.firstRoundDetermined=f.length)),f=[],c=m}return r.unknown=We(i,h),r}function We(e,t){let i=0;for(let s=0;s<t;s++)e[s]===xe&&i++;return i}function es(e,t){const{total:i}=Ee(e),s=yt(e,t),o=new Uint8Array(i),u=Qn(e,s,o);return{grid:o,stats:u,complete:u.status===Et&&u.unknown===0}}const ts={steps:1,rounds:4,deferred:20};function ns(e){const t=e.determined||0,i=t>0?1-e.firstRoundDetermined/t:0,s=ts,o=s.steps*e.steps+s.rounds*e.rounds+s.deferred*i;return{score:Math.round(o*10)/10,steps:e.steps,rounds:e.rounds,lineSolves:e.lineSolves,deferredRatio:Math.round(i*1e3)/1e3}}function ss(e,t){const i=t%e.z,s=(t-i)/e.z,o=s%e.y;return[(s-o)/e.y,o,i]}const Xe=new Map;function ze(e){const t=Xe.get(e.id);if(t!==void 0)return t;let i=0;try{const s=ct(e),{stats:o}=es(e.dims,Ne(e.dims,s));i=ns(o).score}catch{i=0}return Xe.set(e.id,i),i}const je=Object.freeze({1:1,2:2}),Ze=e=>e===Q?X:ae;function os({session:e,onSpend:t}={}){const{dims:i,solution:s,state:o}=e,{lines:u}=Ee(i),h=yt(i,e.clues),d=l=>{const[k,x,E]=ss(i,l);return{x:k,y:x,z:E}};let g=0,p=null,c=0,r=0;function a(){let l=2166136261;for(let k=0;k<o.length;k++)l^=o[k]+k,l=Math.imul(l,16777619);return l>>>0}function f(){const l=new Uint8Array(o.length),k=new Set;for(let x=0;x<o.length;x++){const E=!!s[x];o[x]===X?E?l[x]=Q:k.add(x):o[x]===ae&&(E?k.add(x):l[x]=ye)}return{grid:l,wrong:k}}function b(){const{grid:l,wrong:k}=f(),x=new Uint8Array(Math.max(i.x,i.y,i.z)),E=[];for(const C of u){const{indices:$,n:S,id:N}=C;for(let A=0;A<S;A++)x[A]=l[$[A]];const R=vt(x,S,h[N]);if(R===se||R<=0)continue;const L=[];let T=!1;for(let A=0;A<S;A++){const M=$[A];k.has(M)&&(T=!0),l[M]===xe&&x[A]!==xe&&L.push({i:M,value:x[A],...d(M)})}L.length!==0&&E.push({line:C,clue:h[N],gains:L.length,cells:L,hasWrong:T})}return E.sort((C,$)=>Number($.hasWrong)-Number(C.hasWrong)||$.gains-C.gains||C.line.id-$.line.id),E}function m(){for(let l=0;l<o.length;l++)if(!s[l]&&o[l]===X)return{i:l,value:ye,...d(l)};for(let l=0;l<o.length;l++)if(s[l]&&o[l]!==X)return{i:l,value:Q,...d(l)};return null}function v(l){c+=1,r+=l,t?.({cost:l,uses:c,points:r})}function n(){if(e.solved)return null;const l=a();l!==p&&(g=0),g=Math.min(g+1,2),p=l;const x=b()[0];if(!x){const $=m();if(!$)return null;g=2;const S=je[2];return v(S),e.set($.i,Ze($.value)),p=a(),{stage:2,cost:S,points:r,uses:c,line:null,clue:null,gains:1,cells:[$],applied:$}}const E={cost:je[g],line:{id:x.line.id,axis:x.line.axis,a:x.line.a,b:x.line.b,indices:Array.from(x.line.indices)},clue:[...x.clue],gains:x.gains,cells:x.cells};if(g===1)return v(E.cost),{stage:1,...E,points:r,uses:c,applied:null};const C=x.cells.reduce(($,S)=>S.i<$.i?S:$,x.cells[0]);return v(E.cost),e.set(C.i,Ze(C.value)),p=a(),{stage:2,...E,points:r,uses:c,applied:C}}return{next:n,peek:()=>a()===p?Math.min(g+1,2):1,uses:()=>c,points:()=>r,reset(){g=0,p=null}}}function kt(e,t){let i="";for(let s=0;s<t.length;s++)i+=t[s]?"1":"0";return`${e.x}x${e.y}x${e.z}:${i}`}function rs(e){const t=new Map;for(const i of e??[]){if(!i?.dims||!i?.cells)continue;const s=kt(i.dims,i.cells);t.has(s)||t.set(s,i.name??i.id)}return t}function is(e,t,{index:i=null,fallback:s=null}={}){if(e?.name)return{name:e.name,source:"spec"};if(i&&t){const o=i.get(kt(e.dims,t));if(o)return{name:o,source:"catalogue"}}return{name:s??e?.id??"???",source:"fallback"}}const as=.5,ge=e=>Math.round(e*10)/10;function Je(e,{isSolved:t,scoreFor:i,share:s=as}={}){const o=[];let u=!0;for(let h=0;h<e.length;h++){const d=e[h],g=d.puzzles??[];let p=0,c=0,r=0,a=0;for(const m of g){const v=i(m);p+=v,v>a&&(a=v),t(m.id)&&(c+=v,r++)}const f=g.length>=2?p-a:p,b=Math.min(p*s,f);o.push({levelId:d.id,index:h,unlocked:u,cleared:r,puzzleCount:g.length,earned:ge(c),total:ge(p),required:ge(b),remaining:ge(Math.max(0,b-c))}),u=p===0?u:c>=b}return o}const Qe=0,ls=640,cs=140,et=700,us=1.5,ds=.78,fs="(min-width: 900px)",ms=.14,tt=14,V=(e,t,i,s)=>{const o=e.createElement(t);return i&&(o.className=i),s!==void 0&&(o.textContent=s),o};function ps({doc:e=document,root:t=e.body,sfx:i=null}={}){const s=V(e,"div","fx-clear");s.hidden=!0,s.setAttribute("role","dialog"),s.setAttribute("aria-modal","true"),s.setAttribute("aria-label","퍼즐 완료");const o=V(e,"div","fx-sparks"),u=V(e,"div","fx-card"),h=V(e,"div","fx-card-eyebrow","SOLVED"),d=V(e,"h2","fx-card-name",""),g=V(e,"div","fx-card-sub",""),p=V(e,"div","fx-card-best","🏆 신기록");p.hidden=!0;const c=V(e,"div","fx-card-stats"),r={};for(const[L,T]of[["time","시간"],["mistakes","실수"],["hints","힌트"]]){const A=V(e,"div","fx-card-stat"),M=V(e,"b",null,"-");A.append(M,V(e,"span",null,T)),c.appendChild(A),r[L]=M}const a=V(e,"div","fx-card-prev",""),f=V(e,"div","fx-card-unlock","");f.hidden=!0;const b=V(e,"div","fx-card-actions"),m=V(e,"button","fx-btn","목록으로"),v=V(e,"button","fx-btn fx-btn--primary","다음 퍼즐");b.append(m,v),u.append(h,d,g,p,c,a,f,b),s.append(o,u),t.appendChild(s);const n=[];let l=!1,k={},x=null;const E=(L,T)=>n.push(setTimeout(T,L)),C=()=>{for(const L of n)clearTimeout(L);n.length=0};function $(L){if(o.replaceChildren(),!!L)for(let T=0;T<tt;T++){const A=V(e,"i"),M=T/tt*Math.PI*2+(T%2?.22:0),I=150+T%4*46;A.style.setProperty("--dx",`${Math.cos(M)*I}px`),A.style.setProperty("--dy",`${Math.sin(M)*I*.72}px`),A.style.setProperty("--rot",`${(T%2?1:-1)*(180+T*24)}deg`),A.style.animationDelay=`${T%5*70}ms`,o.appendChild(A)}}function S({grid:L,dims:T,solution:A,filledValue:M,motion:I}){const z=[];for(let w=0;w<T.y;w++){const B=[];for(let D=0;D<T.x;D++)for(let G=0;G<T.z;G++){const y=(D*T.y+w)*T.z+G;A[y]&&B.push(y)}B.length&&z.push(B)}const O=w=>{for(const B of w)L.setState(B,M)};if(E(Qe,()=>{for(let w=0;w<A.length;w++)L.setState(w,be);I||z.forEach(O)}),!I)return;const _=ls/Math.max(1,z.length);z.forEach((w,B)=>{E(Qe+40+_*B,()=>{O(w),i?.play("tap")})})}function N(L,T){if(!L?.controls)return;const{controls:A,camera:M}=L,I={autoRotate:A.autoRotate,speed:A.autoRotateSpeed,position:M?.position.clone(),target:A.target?.clone()};x=()=>{A.autoRotate=I.autoRotate,A.autoRotateSpeed=I.speed,I.position&&M.position.copy(I.position),I.target&&A.target.copy(I.target),A.update?.(),x=null},E(cs,()=>{if(M)if(globalThis.matchMedia?.(fs).matches)M.position.sub(A.target).multiplyScalar(ds).add(A.target);else{const _=2*M.position.distanceTo(A.target)*Math.tan(M.fov*Math.PI/360)*ms;A.target.y-=_,M.position.y-=_}A.update?.(),T&&(A.autoRotate=!0,A.autoRotateSpeed=us)})}function R(){l&&(l=!1,C(),x?.(),s.classList.remove("fx-clear--on"),s.hidden=!0,o.replaceChildren(),k={})}return m.addEventListener("click",()=>{i?.play("tap");const L=k.onMenu;R(),L?.()}),v.addEventListener("click",()=>{i?.play("tap");const L=k.onNext;R(),L?.()}),{run(L){C(),l=!0,k={onNext:L.onNext,onMenu:L.onMenu};const T=L.motion!==!1;d.textContent=L.name,g.textContent=L.subtitle??"",r.time.textContent=re(L.result.ms),r.mistakes.textContent=String(L.result.mistakes),r.hints.textContent=String(L.result.hintUses??0),p.hidden=!L.result.isBest;const A=L.result.previousBest;a.textContent=L.result.isBest?A?`이전 최고 ${re(A.ms)}`:"첫 클리어":A?`최고 기록 ${re(A.ms)}`:"",f.hidden=!L.unlocked,f.textContent=L.unlocked?`🔓 ${L.unlocked} 해금!`:"",v.hidden=!L.hasNext,v.textContent="다음 퍼즐",$(T),L.grid&&L.solution&&S({grid:L.grid,dims:L.dims,solution:L.solution,filledValue:L.filledValue,motion:T}),N(L.view,T),i?.play("clear"),L.unlocked&&E(et+260,()=>i?.play("unlock")),s.hidden=!1,E(T?et:60,()=>{s.classList.add("fx-clear--on"),v.focus?.()})},close:R,isOpen:()=>l,dispose(){R(),s.remove()}}}const nt="tag-btn";function st(e,t){for(const i of t){const s=e.querySelector(i);if(s)return s}return null}const ee=(e,t,i,s)=>{const o=e.createElement(t);return i&&(o.className=i),s!==void 0&&(o.textContent=s),o};function hs({doc:e=document,sfx:t=null,onHint:i,onToggleMute:s}={}){const o=st(e,["#screen-game .puzzle-info","#screen-game .band--top","#screen-game header"])??e.body,u=ee(e,"span","fx-stat","⏱ 00:00");u.title="경과 시간";const h=ee(e,"span","fx-stat","✖ 0");h.title="실수 — 틀린 칸을 그대로 둔 횟수";const d=ee(e,"span","fx-stat fx-stat--best","");d.title="최고 기록",d.hidden=!0,o.append(u,h,d);const g=st(e,["#screen-game .band--bottom","#screen-game footer"])??e.body,p=ee(e,"div","fx-row fx-row--end"),c=ee(e,"button",nt,"💡");c.title="힌트",c.setAttribute("aria-label","힌트");const r=ee(e,"button",nt,"🔇");r.title="소리 켜기",r.setAttribute("aria-label","소리 켜기"),p.append(c,r),g.appendChild(p);const a=ee(e,"div","fx-banner");a.hidden=!0,a.setAttribute("role","status"),e.body.appendChild(a);const f=ee(e,"div","fx-toast");f.hidden=!0,f.setAttribute("role","status"),e.body.appendChild(f);let b=0,m=0,v=0;return c.addEventListener("click",()=>i?.()),r.addEventListener("click",()=>s?.()),{setTimer(n){u.textContent!==`⏱ ${n}`&&(u.textContent=`⏱ ${n}`)},setMistakes(n,{bump:l=!1}={}){const k=`✖ ${n}`;h.textContent!==k&&(h.textContent=k),h.classList.toggle("fx-stat--alert",n>0),l&&(clearTimeout(v),h.classList.remove("fx-stat--bump"),h.offsetWidth,h.classList.add("fx-stat--bump"),v=setTimeout(()=>h.classList.remove("fx-stat--bump"),400))},setBest(n){d.hidden=!n,d.textContent=n?`🏆 ${n}`:""},setHintStage(n){const l=n===2?"힌트 — 칸 하나 확정 (2점)":"힌트 — 볼 줄 알려주기 (1점)";c.title=l,c.setAttribute("aria-label",l),c.textContent=n===2?"💡!":"💡"},setMuted(n){r.textContent=n?"🔇":"🔈";const l=n?"소리 켜기":"소리 끄기";r.title=l,r.setAttribute("aria-label",l),r.setAttribute("aria-pressed",String(n))},setControlsEnabled(n){c.disabled=!n,c.style.opacity=n?"":"0.4"},banner(n,l=7e3){clearTimeout(b),a.innerHTML=n,a.hidden=!1,requestAnimationFrame(()=>requestAnimationFrame(()=>a.classList.add("fx-banner--on"))),l>0&&(b=setTimeout(()=>this.hideBanner(),l))},hideBanner(){clearTimeout(b),a.classList.remove("fx-banner--on"),b=setTimeout(()=>{a.hidden=!0},250)},toast(n,l=3200){clearTimeout(m),f.textContent=n,f.hidden=!1,t?.play("tap"),requestAnimationFrame(()=>requestAnimationFrame(()=>f.classList.add("fx-toast--on"))),m=setTimeout(()=>{f.classList.remove("fx-toast--on"),m=setTimeout(()=>{f.hidden=!0},250)},l)},dispose(){clearTimeout(b),clearTimeout(m),clearTimeout(v);for(const n of[u,h,d,p,a,f])n.remove()}}}const ot=6e3,gs=1100,Ce=1.22;function bs({scene:e,dims:t,gap:i=It}){const s=$t(t,i),o=new Ut(Le*Ce,Le*Ce,Le*Ce),u=new Pt({color:Me.x,transparent:!0,opacity:0,depthWrite:!1}),h=Math.max(t.x,t.y,t.z),d=new Ot(o,u,h);d.count=0,d.frustumCulled=!1,d.renderOrder=2,e.add(d);const g=new Dt;let p=0,c=!1;function r(){c=!1,p=0,d.count=0,u.opacity=0}return{showLine(a,f="x"){if(r(),!a?.length)return;u.color.set(Me[f]??Me.x);let b=0;for(const m of a){if(b>=d.instanceMatrix.count)break;g.makeTranslation(s[m*3],s[m*3+1],s[m*3+2]),d.setMatrixAt(b++,g)}d.count=b,d.instanceMatrix.needsUpdate=!0,c=!0,p=0},clear:r,tick(a){if(!c)return;if(p+=a,p>=ot){r();return}const f=.18+.22*(.5+.5*Math.sin(p/gs*Math.PI*2)),b=Math.min(1,(ot-p)/900);u.opacity=f*b},dispose(){e.remove(d),d.dispose?.(),o.dispose(),u.dispose()}}}const Te="fx-lock-badge",$e="fx-locked";function xs({doc:e=document,levels:t,getUnlocks:i,onBlocked:s}={}){const o=e.getElementById("levels-grid");if(!o)return{refresh(){},dispose(){}};let u=!1,h=[];const d=()=>[...o.children].filter(r=>r.nodeType===1);function g(){if(!u){u=!0;try{h=i?.()??[];const r=d();if(r.length!==t.length)return;r.forEach((a,f)=>{const b=h[f];a.querySelector(`.${Te}`)?.remove();const m=b&&!b.unlocked;if(a.classList.toggle($e,!!m),a.dataset.fxLevel=t[f].id,!m){a.removeAttribute("aria-disabled");return}a.setAttribute("aria-disabled","true");const v=h[f-1],n=e.createElement("div");n.className=Te;const l=v&&v.required>0?Math.min(1,v.earned/v.required):0,k=e.createElement("div");k.className="fx-lock-bar";const x=e.createElement("i");x.style.width=`${Math.round(l*100)}%`,k.appendChild(x);const E=e.createElement("span");E.textContent=v?`🔒 ${Math.round(v.earned)} / ${Math.round(v.required)}`:"🔒",n.append(E,k),a.appendChild(n)})}finally{u=!1}}}function p(r){const a=r.target.closest?.("#levels-grid > *");if(!a||!a.classList.contains($e))return;r.stopPropagation(),r.preventDefault();const f=d().indexOf(a);s?.({level:t[f],info:h[f],previous:h[f-1]})}o.addEventListener("click",p,!0);const c=new MutationObserver(()=>g());return c.observe(o,{childList:!0}),g(),{refresh:g,dispose(){c.disconnect(),o.removeEventListener("click",p,!0);for(const r of d())r.classList.remove($e),r.querySelector(`.${Te}`)?.remove()}}}const ys=`
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
`,rt="fx-rewards-styles";function vs(e=document){if(e.getElementById(rt))return;const t=e.createElement("style");t.id=rt,t.textContent=ys,e.head.appendChild(t)}const Es=500,ks={x:"X",y:"Y",z:"Z"},ws={x:(e,t)=>`y=${e}, z=${t}`,y:(e,t)=>`x=${e}, z=${t}`,z:(e,t)=>`x=${e}, y=${t}`};function Ls({levels:e,view:t,openPuzzle:i,backToList:s,doc:o=document}={}){vs(o);const u=rs(Re),h=gt(),d=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"),g=()=>h.reducedMotion===!0?!1:h.reducedMotion===!1?!0:!d?.matches,p=()=>o.documentElement.classList.toggle("fx-motion",g());p(),d?.addEventListener?.("change",p);const c=Gn({muted:h.muted,onMutedChange:w=>{h.muted=w,vn({muted:w}),a.setMuted(w)}}),r=()=>Je(e,{isSolved:w=>le(w).solved,scoreFor:ze}),a=hs({doc:o,sfx:c,onHint:()=>S(),onToggleMute:()=>{c.toggleMuted()||c.play("reveal")}});a.setMuted(c.muted());const f=ps({doc:o,sfx:c}),b=xs({doc:o,levels:e,getUnlocks:r,onBlocked:({level:w,previous:B})=>{const D=B?Math.max(0,Math.round(B.required-B.earned)):0;a.toast(B?`${w.name} 잠김 — 앞 레벨에서 난이도 ${D}점 더 모으면 열립니다`:`${w.name} 잠김`)}});let m=null,v=null,n=null,l=null,k=null,x=null,E=null;function C({bump:w=!1}={}){if(!n)return;a.setTimer(re(n.elapsedMs())),a.setMistakes(n.mistakes(),{bump:w});const B=n.best();a.setBest(B?re(B.ms):null),a.setHintStage(l?.peek()??1),a.setControlsEnabled(!m?.solved)}const $=setInterval(()=>{n?.running()&&a.setTimer(re(n.elapsedMs()))},Es);function S(){if(!l||!m||m.solved)return;const w=l.next();if(!w){a.banner("더 알려줄 게 없습니다 — 이미 다 풀렸어요");return}if(w.stage===1){c.play("hint"),k?.showLine(w.line.indices,w.line.axis);const B=ws[w.line.axis](w.line.a,w.line.b),D=w.clue.length?w.clue.join(" "):"0";a.banner(`<b>${ks[w.line.axis]}축</b> 줄 (${B}) 을 다시 읽어보세요 · 클루 <span class="fx-clue">${D}</span> · 지금 <b>${w.gains}칸</b>이 결정됩니다`)}else{c.play("reveal"),w.line&&k?.showLine(w.line.indices,w.line.axis);const B=w.applied,D=w.applied.value===1?"블록":"빈 칸";a.banner(`(x, y, z) = (${B.x}, ${B.y}, ${B.z}) 은 <b>${D}</b> 입니다`)}C()}function N({value:w}){c.play(w===X?"fill":w===ae?"mark":"erase"),C()}function R(){c.play("mistake"),C({bump:!0})}function L(w){k?.clear(),a.hideBanner(),a.setControlsEnabled(!1),C();const B=Je(e,{isSolved:Z=>Z===m.spec.id||le(Z).solved,scoreFor:ze}),D=B.find((Z,te)=>Z.unlocked&&E?.[te]?.unlocked===!1);b.refresh(),E=B;const{spec:G}=m,y=e.find(Z=>Z.puzzles.some(te=>te.id===G.id)),U=y?y.puzzles.findIndex(Z=>Z.id===G.id):-1,F=y&&U>=0?y.puzzles[U+1]:null,{name:ke}=is(G,m.solution,{index:u,fallback:y&&U>=0?`${y.name} #${U+1}`:G.id});f.run({name:ke,subtitle:`${G.dims.x}×${G.dims.y}×${G.dims.z} · 난이도 ${ze(G)}`,result:w,grid:v,view:t,dims:G.dims,solution:m.solution,filledValue:X,motion:g(),unlocked:D?e[D.index]?.name??null:null,hasNext:!!F,onNext:()=>F?i?.(F):s?.(),onMenu:()=>s?.()})}const T=o.getElementById("screen-game"),A=()=>!!T&&!T.hidden;function M(){if(!n)return;A()&&!o.hidden&&!m?.solved?n.resume():n.pause()}const I=T?new MutationObserver(()=>M()):null;I?.observe(T,{attributes:!0,attributeFilter:["hidden"]});const z=()=>M();o.addEventListener("visibilitychange",z);const O=()=>n?.flush();globalThis.addEventListener?.("pagehide",O);function _(){f.close(),a.hideBanner(),x?.(),x=null,k?.dispose(),k=null,n?.dispose(),n=null,l=null,m=null,v=null}return{openPuzzle({session:w,grid:B}){_(),m=w,v=B,E=r(),n=Wn({session:m}),l=os({session:m,onSpend:({cost:D})=>n.noteHint(D)}),t?.scene&&(k=bs({scene:t.scene,dims:m.dims}),x=t.onFrame?.(D=>k?.tick(D))),m.on("cell",N),n.on("mistake",R),n.on("cleared",L),C(),M()},closePuzzle:_,unlocks:r,refreshLocks:()=>b.refresh(),debug:{attempt:()=>n,hint:()=>S(),unlocks:r,solveNow(){if(!m)return!1;for(let w=0;w<m.solution.length;w++)m.set(w,m.solution[w]?X:be);return!0}},dispose(){_(),clearInterval($),I?.disconnect(),o.removeEventListener("visibilitychange",z),globalThis.removeEventListener?.("pagehide",O),b.dispose(),f.dispose(),a.dispose(),c.dispose()}}}const it="Solved! 🎉",wt=document.getElementById("scene"),Lt=new URLSearchParams(location.search),Ie=Number(Lt.get("fitmargin")),Y=Nt(wt,{...Number.isFinite(Ie)&&Ie>0?{fitMargin:Ie}:{}}),ce=Bt(Y.renderer,{overlay:Lt.has("perf")});let q=null,j=null,oe=null,at=!1;const ue=Mn(),Mt=Bn(),ie=_n({onUndo:()=>q?.undo(),onToggleMode:()=>qe.toggleMode()}),Oe=In({levels:_e,getProgress:ve,onOpenPuzzle:St,show:ue.show}),De=Ls({levels:_e,view:Y,openPuzzle:St,backToList:()=>Oe.reopenCurrentLevel()});function lt(){Mt.render(q.dims,q.clues,q.currentRuns())}function Ms(){De.closePuzzle(),j&&(Y.scene.remove(j.group),j.dispose(),j=null),oe&&(Y.scene.remove(oe.group),oe.dispose(),oe=null)}function St(e){Ms(),q=kn(e),j=Rt(q.dims),j.setAll(q.state),Y.scene.add(j.group),oe=_t(q.dims),Y.scene.add(oe.group),Y.frameCamera(q.dims),ie.setDims(`${q.dims.x}×${q.dims.y}×${q.dims.z}`),ie.setStatus(q.solved?it:""),lt(),q.on("cell",({i:t,value:i})=>{j.setState(t,i),lt()}),q.on("solved",()=>ie.setStatus(it)),De.openPuzzle({session:q,grid:j}),Fe.openPuzzle(e),ue.show("screen-game"),Y.resize(),at||(at=!0,ce.mark("first-puzzle"))}const qe=On({canvas:wt,view:Y,getSession:()=>q,getGrid:()=>j,onModeChange:(e,t)=>ie.setMode(e,t)});ie.setMode(qe.mode());document.getElementById("btn-start").addEventListener("click",()=>{Oe.renderLevels(),ue.show("screen-levels")});document.getElementById("btn-levels-back").addEventListener("click",()=>ue.show("screen-main"));document.getElementById("btn-puzzles-back").addEventListener("click",()=>ue.show("screen-levels"));document.getElementById("btn-game-back").addEventListener("click",()=>Oe.reopenCurrentLevel());window.addEventListener("resize",()=>Y.resize());const At=Ln({view:Y,getGrid:()=>j}),Fe=Fn({peel:At,view:Y,getDims:()=>q?.dims??null});Y.onFrame(e=>{ce.beginFrame(),Mt.setActiveAxis(Y.facingAxis()),Fe.sync(e)});Y.onFrameEnd(()=>ce.endFrame());Y.start();window.__nonogram={perf:()=>ce.stats(),perfReset:()=>ce.reset(),grid:()=>j?.stats()??null,session:()=>q,mode:()=>qe.mode(),levels:()=>_e.map(e=>({id:e.id,puzzles:e.puzzles.map(t=>({id:t.id,dims:t.dims}))})),rewards:De.debug,peel:()=>At.state(),peelUi:()=>Fe.model()};
