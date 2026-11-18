// 完全复刻 upload-source-gh.mjs 的 jobs 构造，二分定位 create-tree 404 的坏 item
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
const ROOT = path.resolve(import.meta.dirname, '..')
const T = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const H = { Authorization: 'Bearer ' + T, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'x' }
const api = 'https://api.github.com/repos/meiyoume/tide-music-android-release'

const SKIP_DIRS = new Set(['node_modules','.git','.gradle','build','build-staging','shots','apk-release','.idea','.vscode','release'])
const SKIP_FILE = [/(^|\/)(local\.properties|keystore\.properties|\.env.*|.*credentials.*|.*secret.*)$/i,/\.(keystore|jks|p12|pem|key|apk|apks|aab|log|tmp|swp)$/i,/^(hs_err_pid|replay_pid)/i,/(^|\/)\.DS_Store$/i,/^\$null$/i,/^\.gitignore$/i,/^README\.md$/i,/^tools\/\.upload-source-cache\.json$/i]
const files=[]
function w(d,r){for(const e of fs.readdirSync(d,{withFileTypes:true})){const rr=r?r+'/'+e.name:e.name;const p=path.join(d,e.name);if(e.isDirectory()){if(SKIP_DIRS.has(e.name)||SKIP_DIRS.has(rr))continue;w(p,rr)}else if(e.isFile()&&!SKIP_FILE.some(re=>re.test(rr)))files.push({rel:rr,abs:p})}}w(ROOT,'')

const cache=JSON.parse(fs.readFileSync(path.join(ROOT,'tools','.upload-source-cache.json'),'utf8'))
const items=[]
for(const f of files){
  const buf=fs.readFileSync(f.abs)
  const key=f.rel+':'+crypto.createHash('sha1').update(buf).digest('hex')
  items.push({path:f.rel,mode:'100644',type:'blob',sha:cache[key]})
}
// EXTRA / README 也是用 buf 的 sha1 做 key
const EXTRA=[
  {rel:'.gitignore',content:'node_modules/\n'},
  {rel:'android/keystore.properties.example',content:'storeFile=lxmusic.keystore\n'},
]
for(const e of [...EXTRA,{rel:'README.md',content:'x'}]){
  const buf=Buffer.from(e.content)
  const key=e.rel+':'+crypto.createHash('sha1').update(buf).digest('hex')
  items.push({path:e.rel,mode:'100644',type:'blob',sha:cache[key]})
}
console.log('items',items.length,'missing',items.filter(x=>!/^[0-9a-f]{40}$/.test(x.sha||'')).length)

async function post(tree){
  const r=await fetch(api+'/git/trees',{method:'POST',headers:H,body:JSON.stringify({tree})})
  const t=await r.text()
  return {status:r.status,body:t.slice(0,200)}
}
const pathChars=new Set()
items.forEach(x=>{for(const c of x.path)pathChars.add(c.charCodeAt(0))})
console.log('non-ascii paths',items.filter(x=>/[^\x20-\x7e]/.test(x.path)).map(x=>x.path))

// 分块 POST（每块 100），找出哪一块坏
for(let off=0;off<items.length;off+=100){
  const chunk=items.slice(off,off+100)
  const r=await post(chunk)
  console.log('chunk',off,off+chunk.length,r.status,r.status===201?'ok':r.body)
  if(r.status!==201){
    // 逐个定位
    for(const it of chunk){const rr=await post([it]);if(rr.status!==201)console.log('  BAD',it.path,it.sha,rr.status,rr.body)}
    break
  }
}
