import type {AspectRatio, Project, Scene, Theme} from '../shared/types';
import {fitSceneDuration} from '../shared/timing';
import {saveBrowserAsset, resolveBrowserProject} from './browser-assets';
import {startBrowserRender, getBrowserRender, cancelBrowserRender} from './browser-renderer';

export const browserRuntime = import.meta.env.VITE_RUNTIME === 'browser';
const brief = (text:string, words=10, length=130) => text.replace(/\s+/g,' ').trim().split(' ').slice(0,words).join(' ').slice(0,length);
const divide = (text:string,count:number) => {const words=text.trim().split(/\s+/);return Array.from({length:count},(_,i)=>words.slice(Math.round(i*words.length/count),Math.round((i+1)*words.length/count)).join(' '));};
type GenerateInput={prompt:string;script:string;theme:Theme;aspectRatio:AspectRatio;duration:number};

export function planBrowserProject(input:GenerateInput):Project {
  if(!input.prompt.trim()&&!input.script.trim())throw new Error('Add a prompt or script to create your video.');
  if(!Number.isFinite(input.duration)||input.duration<5||input.duration>120)throw new Error('Choose a video length between 5 and 120 seconds.');
  const quoted=[...input.prompt.matchAll(/[“"]([^”"]+)[”"]/g)].map(match=>match[1]);
  let content=input.script.trim() || quoted.join('. ');
  if(!content){
    const colon=input.prompt.indexOf(':');
    content=(colon>=0?input.prompt.slice(colon+1):input.prompt).replace(/\b(?:use|with)\s+(?:warm|bold|orange|purple|green|mint|clean|punchy|oversized|confident|a clean)[\s\S]*$/i,'').trim();
    content=content.replace(/^(?:please\s+)?(?:create|make|generate|design|explain)\s+(?:a\s+)?(?:bold\s+|inspiring\s+)?(?:\d+[- ]second\s+)?(?:launch\s+|kinetic typography\s+|motion graphics?\s+)?(?:video|film)?\s*(?:about|for|on)?\s*/i,'').trim();
  }
  if(!content)content=input.prompt.trim();
  const count=Math.min(8,Math.max(2,Math.round(input.duration/5)),Math.max(2,Math.ceil(content.split(/\s+/).length/12)));
  const chunks=divide(content,count);
  const notes=divide(input.script||content,count);
  const title=brief(content,8,100)||'Your story in motion';
  const scenes:Scene[]=chunks.map((chunk,index)=>({
    id:crypto.randomUUID(),type:index===0?'title':index===count-1?'outro':index%3===0?'steps':'kinetic',
    title:brief(chunk||title),subtitle:index===0?'YOUR STORY, SET IN MOTION':index===count-1?'KEEP THE MOMENTUM GOING':'',
    duration:5,items:index%3===0&&index>0&&index<count-1?chunk.split(/[,;]|\.\s/).filter(Boolean).slice(0,4).map(item=>brief(item,8,90)):[],value:'',narration:notes[index],
  }));
  return {version:1,title,prompt:input.prompt,script:input.script,theme:input.theme,aspectRatio:input.aspectRatio,fps:30,scenes:fitSceneDuration(scenes,input.duration),audioVolume:.7,narratorVolume:1,narratorPosition:'right',showNarrator:true};
}

export async function browserApi<T>(path:string,options?:RequestInit):Promise<T> {
  const method=options?.method||'GET';
  if(path==='/api/health')return {ok:true,browserMode:true,ollama:{available:false,models:[]},renderer:{browser:true}} as T;
  if(path==='/api/generate'){
    const input=JSON.parse(String(options?.body||'{}'));
    return {project:planBrowserProject(input),source:'template'} as T;
  }
  if(path==='/api/upload'){
    if(!(options?.body instanceof FormData))throw new Error('Choose a media file to upload.');
    const file=options.body.get('file');const kind=options.body.get('kind');
    if(!(file instanceof File)||(kind!=='audio'&&kind!=='video'))throw new Error('Choose an audio or narrator video file.');
    return await saveBrowserAsset(file,kind) as T;
  }
  if(path==='/api/render'&&method==='POST'){
    const {project,quality}=JSON.parse(String(options?.body||'{}'));
    const resolved=await resolveBrowserProject(project);
    return startBrowserRender(resolved,quality) as T;
  }
  const renderId=path.match(/^\/api\/render\/([a-zA-Z0-9-]+)$/)?.[1];
  if(renderId)return (method==='DELETE'?cancelBrowserRender(renderId):getBrowserRender(renderId)) as T;
  throw new Error('This action is not available in the browser studio.');
}
