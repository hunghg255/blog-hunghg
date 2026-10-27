import{r as m,j as s}from"./index-B9ermPWz.js";import{u as B,S as k,L as P}from"./shared-2KB7AQrv.js";const y=e=>e.slice(e.lastIndexOf(".")+1).toLowerCase(),w=(e,...d)=>e.filter(t=>d.includes(y(t.name))),C="__loopGuard";function S(e){let d="",t=0,c=0;const a=e.length,h=n=>!!n&&/[\w$]/.test(n),u=n=>{const r=e[n];if(r==="/"&&e[n+1]==="/"){const o=e.indexOf(`
`,n);return o===-1?a:o}if(r==="/"&&e[n+1]==="*"){const o=e.indexOf("*/",n+2);return o===-1?a:o+2}if(r==='"'||r==="'"||r==="`"){let o=n+1;for(;o<a&&e[o]!==r;)o+=e[o]==="\\"?2:1;return o+1}return n},f=n=>{for(;n<a&&/\s/.test(e[n]);)n++;if(e[n]!=="(")return-1;let r=0;for(;n<a;){const o=u(n);if(o!==n){n=o;continue}if(e[n]==="(")r++;else if(e[n]===")"&&--r===0)return n+1;n++}return-1};for(;t<a;){const n=u(t);if(n!==t){d+=e.slice(t,n),t=n;continue}const r=/^(for|while|do)\b/.exec(e.slice(t,t+6));if(r&&!h(e[t-1])&&e[t-1]!=="."){const o=r[1],g=o==="do"?t+2:f(t+o.length);if(g!==-1){let p=g;for(;p<a&&/\s/.test(e[p]);)p++;if(e[p]==="{"){c++,d+=e.slice(t,p+1)+` if (${C}(${c})) break;`,t=p+1;continue}}}d+=e[t],t++}return{code:d,loops:c}}const D=e=>`
(function () {
  var first = Object.create(null), scheduled = false;
  window.${C} = function (id) {
    var now = Date.now();
    if (!scheduled) { scheduled = true; setTimeout(function () { first = Object.create(null); scheduled = false; }, 0); }
    if (first[id] === undefined) first[id] = now;
    if (now - first[id] > ${e}) {
      first[id] = now;
      console.error('Vòng lặp #' + id + ' chạy quá ${e}ms, đã dừng (có thể là vòng lặp vô hạn)');
      return true;
    }
    return false;
  };
})();`;function I(e,{loopLimitMs:d=1e3}={}){const t=w(e,"html","htm")[0]?.content??"",c=new DOMParser().parseFromString(t,"text/html"),a=c.createElement("style");a.textContent=w(e,"css").map(o=>o.content).join(`
`),c.head.appendChild(a);const h=c.createElement("script");h.textContent=O+D(d),c.head.prepend(h);const u=w(e,"js","jsx"),{code:f,loops:n}=S(u.map(o=>`// ${o.name}
${o.content}`).join(`;
`)),r=c.createElement("script");return r.textContent=f,c.body.appendChild(r),{html:"<!doctype html>"+c.documentElement.outerHTML,loops:n}}const O=`
(function () {
  function post(msg) { msg.source = 'ud-preview'; parent.postMessage(msg, '*'); }
  ['log', 'warn', 'error'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      var text = Array.prototype.map.call(arguments, function (a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
      post({ type: 'console', level: level, text: text });
      orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) { post({ type: 'console', level: 'error', text: String(e.message) }); });
  window.addEventListener('load', function () { post({ type: 'loaded' }); });
})();`,L="allow-scripts allow-modals allow-forms",v={"Bình thường":[{name:"index.html",content:`<h2>Bộ đếm</h2>
<button id="btn">+1</button> <b id="out">0</b>`},{name:"style.css",content:`body { font-family: sans-serif; padding: 12px }
button { font-size: 18px }`},{name:"app.js",content:`let count = 0
const out = document.getElementById('out')
document.getElementById('btn').onclick = () => {
  out.textContent = ++count
  console.log('count =', count)
}
console.log('app.js đã chạy')`}],"Vòng lặp vô hạn":[{name:"index.html",content:'<p id="msg">Đang chạy…</p>'},{name:"app.js",content:`let i = 0
while (true) {
  i++ // quên điều kiện dừng
}
document.getElementById('msg').textContent = 'Vẫn sống, i = ' + i
console.log('trang vẫn phản hồi, i =', i)`}],"Hai file dính nhau":[{name:"index.html",content:'<p id="msg"></p>'},{name:"config.js",content:"const greeting = 'Xin chào'"},{name:"App.jsx",content:`document.getElementById('msg').textContent = greeting
console.log('App.jsx chạy được')`}],"HTML có <img onerror>":[{name:"index.html",content:`<p>Ảnh hỏng bên dưới có onerror:</p>
<img src="data:image/png;base64,AAAA" onerror="window.__previewLeak && window.__previewLeak(location.origin); console.log('onerror chạy ở', location.origin)">`}]};function M(e){const d=e.find(g=>["html","htm"].includes(y(g.name)))?.content??"",t=document.createElement("html");t.innerHTML=d;const c=g=>e.filter(p=>y(p.name)===g).map(p=>p.content).join(`
`),a=c("css"),h=c("js")+c("jsx"),{code:u}=S(h),f=t.querySelector("body")??t,n=document.createElement("style");n.textContent=a,(t.querySelector("head")??t).appendChild(n);const r=document.createElement("script");r.textContent=O+`
window.__loopGuard = function () { return false };`,(t.querySelector("head")??t).prepend(r);const o=document.createElement("script");return o.textContent=u,f.appendChild(o),"<!doctype html>"+t.outerHTML}function q(){const[e,d]=m.useState("Bình thường"),[t,c]=m.useState(v["Bình thường"]),[a,h]=m.useState(0),[u,f]=m.useState("ours"),[n,r]=m.useState(0),[o,g]=m.useState(""),[p,b]=m.useState(0),j=m.useRef(null),x=B(40);m.useEffect(()=>(window.__previewLeak=i=>{r(l=>l+1),x.add(`⚠ onerror đã chạy ở trang chính (${i})`,"err")},()=>{delete window.__previewLeak}),[x.add]),m.useEffect(()=>{const i=l=>{l.source!==j.current?.contentWindow||l.data?.source!=="ud-preview"||l.data.type==="console"&&x.add(`[iframe ${l.data.level}] ${l.data.text}`,l.data.level==="error"?"err":l.data.level==="warn"?"warn":void 0)};return window.addEventListener("message",i),()=>window.removeEventListener("message",i)},[x.add]),m.useEffect(()=>{const i=setTimeout(()=>{if(u==="ours"){const l=I(t,{loopLimitMs:300});b(l.loops),g(l.html)}else b(0),g(M(t));x.add(`Dựng lại preview (${u==="ours"?"viết lại":"kiểu gốc"})`,"muted")},1e3);return()=>clearTimeout(i)},[t,u,x.add]);const _=i=>{d(i),c(v[i]),h(0),x.clear()},$=t[a],N=m.useMemo(()=>t.map(i=>i.name),[t]);return s.jsxs("div",{className:"page ud-preview",children:[s.jsx("h1",{children:"Preview code trong iframe sandbox"}),s.jsxs("p",{className:"hint",children:["Iframe dùng ",s.jsxs("code",{children:['sandbox="',L,'"']})," (không có ",s.jsx("code",{children:"allow-same-origin"}),') nên chạy ở origin "null". Chế độ "kiểu gốc" mô phỏng cách ghép trang của bản gốc và không chặn vòng lặp, nên bị khoá với ví dụ vòng lặp vô hạn.']}),s.jsxs("div",{className:"toolbar",children:[s.jsxs("label",{children:["Ví dụ"," ",s.jsx("select",{value:e,onChange:i=>_(i.target.value),"data-testid":"preset",children:Object.keys(v).map(i=>s.jsx("option",{children:i},i))})]}),s.jsxs("label",{children:[s.jsx("input",{type:"radio",checked:u==="ours",onChange:()=>f("ours"),"data-testid":"mode-ours"})," viết lại"]}),s.jsxs("label",{children:[s.jsx("input",{type:"radio",checked:u==="original",onChange:()=>f("original"),disabled:e==="Vòng lặp vô hạn","data-testid":"mode-original"})," ","kiểu gốc"]})]}),s.jsxs("div",{className:"stats",children:[s.jsx(k,{label:"vòng lặp được bảo vệ",value:s.jsx("bdi",{"data-testid":"loops",children:p})}),s.jsx(k,{label:"lần code chạy ở trang chính",value:s.jsx("bdi",{"data-testid":"leaks",children:n})})]}),s.jsxs("div",{className:"split",children:[s.jsxs("div",{children:[s.jsx("div",{className:"ud-preview-tabs",role:"tablist",children:N.map((i,l)=>s.jsx("button",{role:"tab","aria-selected":l===a,onClick:()=>h(l),children:i},i))}),s.jsx("textarea",{className:"ud-preview-code",spellCheck:!1,value:$?.content??"",onChange:i=>c(l=>l.map((E,A)=>A===a?{...E,content:i.target.value}:E)),"data-testid":"code"})]}),s.jsx("iframe",{ref:j,className:"ud-preview-frame",title:"Kết quả code",sandbox:L,srcDoc:o,"data-testid":"frame"})]}),s.jsx(P,{lines:x.lines})]})}export{q as default};
