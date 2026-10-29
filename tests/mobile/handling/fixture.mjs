import {native} from '../nativeLoader.mjs'
import {identity} from '../fixture.mjs'
const {ReportSession}=native('core/report/ReportSession.ets')
export function handlingFixture(role='repair') {
 const views=[],calls=[],saved=[],disposed=[]
 let intercept=null
 const user=identity(role)
 const issue={id:'i',issueNo:'IS-1',pointId:'p',buildingId:'b',floorId:'f',taskId:null,source:'report',createdById:'demo-inspector',reviewAction:'need_evidence',reviewCategory:'description',description:'不可覆盖的原始记录',anomalyType:'异常',status:'pending_review',photos:[],rev:2}
 const order={id:'o',orderNo:'WO-1',pointId:'p',issueId:'i',status:'assigned',assigneeId:'demo-repair',acceptedById:'',measures:'',materials:'',photos:[],reviews:[],timeline:[],rev:3}
 const workspace={epoch:1,buildings:[{id:'b',status:'active'}],points:[{id:'p',buildingId:'b',floorId:'f',status:'active'}],tasks:[],issues:[issue],orders:[order]}
 const access={user,workspace,baseUrl:'http://localhost:8080',client:{send:async(path,options)=>{
  calls.push({path,options})
  if(intercept){const value=intercept(path,options);if(value!==undefined)return value}
  let data
  if(path==='/auth/me')data=access.user
  else if(path.endsWith('/archive'))data=workspace
  else if(path.includes('/supplement-context'))data={issue,existingPhotoCount:0,existingPhotoBytes:0}
  else if(path.includes('/handling-context'))data={order,buildingId:'b',existingPhotoCount:0,existingPhotoBytes:0}
  else if(path.includes('/media?'))data={id:'m',size:3,sha256:'a'.repeat(64)}
  else if(path.endsWith('/supplements'))data={issue:{...issue,rev:3,reviewAction:null}}
  else {const body=JSON.parse(options.body);data={order:{...order,status:body.to,rev:order.rev+1,acceptedById:access.user.id,measures:body.measures??order.measures}}}
  return {ok:true,data,meta:{datasetEpoch:1}}
 },cancel(){}}}
 const session=new ReportSession({access:()=>access,onChange:value=>views.push(value),invalidate:message=>{throw Error(message)},disposePhoto:p=>disposed.push(p),onResult:result=>{
  saved.push(result)
  if(result.order){Object.assign(order,result.order);workspace.orders=[result.order]}
  if(result.issue){Object.assign(issue,result.issue);workspace.issues=[result.issue]}
 }})
 return {session,access,workspace,issue,order,calls,saved,disposed,current:()=>views.at(-1),intercept:value=>{intercept=value}}
}
