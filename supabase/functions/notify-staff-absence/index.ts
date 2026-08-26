import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildStaffEmailHtml } from "../_shared/staff-email.ts";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
const serviceRoleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("APRES_SERVICE_ROLE_KEY")??"";
const resendApiKey=Deno.env.get("RESEND_API_KEY")??"";
const resendFrom=Deno.env.get("APRES_STAFF_EMAIL_FROM")??Deno.env.get("RESEND_FROM")??"Après School Team <staff@apres-school.co.uk>";
const resendReplyTo=Deno.env.get("APRES_REPLY_TO")??Deno.env.get("RESEND_REPLY_TO")??"hello@apres-school.co.uk";
const notificationTo=Deno.env.get("APRES_ABSENCE_NOTIFICATION_TO")??"luke@apres-school.co.uk";
const staffLoginUrl=Deno.env.get("STAFF_LOGIN_URL")??"https://www.apres-school.co.uk/staff-login";
const supabase=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});

serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const actor=await getActor(request.headers.get("Authorization")||"");
    if(!actor)return json({error:"Not authorised"},401);
    const {absenceId}=await request.json();
    if(!absenceId)return json({error:"Absence id is required"},400);
    const absence=await getAbsence(String(absenceId));
    if(!absence)return json({error:"Absence record not found"},404);
    const role=String(actor.role||"").toLowerCase();
    if(absence.profileId!==actor.id&&absence.createdBy!==actor.id&&!['admin','superadmin'].includes(role))return json({error:"You cannot notify this absence"},403);
    const recipients=await approvalRecipients(absence.staffRecordId);
    const sent=[];
    for(const recipient of recipients){
      if(await alreadySent(absence.id,recipient.email)){sent.push(recipient.email);continue;}
      if(!resendApiKey)throw new Error("Email provider is not configured");
      const url=new URL(staffLoginUrl);url.searchParams.set("section","holiday");
      const subject=`Staff absence: ${absence.name} · ${dateRange(absence.startDate,absence.endDate)}`;
      const html=buildStaffEmailHtml({preheader:subject,eyebrow:"Staff absence",title:"A staff absence has been recorded",greeting:`Hi ${firstName(recipient.name)},`,paragraphs:[`${absence.name} has been recorded as absent.`,"Any overlapping rota assignments have been marked as requiring cover. Open the secure platform to view any operational note."],details:[{label:"Staff member",value:absence.name},{label:"Site",value:absence.site||"Not recorded"},{label:"Reason",value:categoryLabel(absence.category)},{label:"Expected absence",value:dateRange(absence.startDate,absence.endDate)}],action:{label:"View absence and rota impact",url:url.toString()},notice:"Health information and staff notes are not included in this email. Use the secure staff platform and avoid forwarding this message.",portalLabel:"Staff absence",footerText:"Secure absence records, rota cover and return-to-work tracking."});
      const text=[`Hi ${firstName(recipient.name)},`,"",`${absence.name} has been recorded as absent.`,`Site: ${absence.site||"Not recorded"}`,`Reason: ${categoryLabel(absence.category)}`,`Dates: ${dateRange(absence.startDate,absence.endDate)}`,"Any operational note is available only in the secure staff platform.","",`Review securely: ${url}`,"","Après School"].filter(Boolean).join("\n");
      const providerId=await sendEmail(recipient.email,subject,text,html);
      await supabase.from("email_logs").insert({recipient_email:recipient.email,recipient_name:recipient.name,email_type:"employee_absence_reported",subject,status:"sent",provider:"resend",provider_message_id:providerId||null,sent_by:actor.id,staff_record_id:absence.staffRecordId,metadata:{absenceId:absence.id,startDate:absence.startDate,endDate:absence.endDate,category:absence.category},sent_at:new Date().toISOString()});
      sent.push(recipient.email);
    }
    await supabase.from("audit_log").insert({actor_id:actor.id,action:"staff_absence_notification_sent",table_name:"staff_absences",record_id:absence.id,metadata:{recipients:sent}});
    return json({emailed:sent.length>0,recipients:sent.length});
  }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Absence notification failed"},500);}
});

async function getActor(header:string){const token=header.replace(/^Bearer\s+/i,"");if(!token)return null;const {data,error}=await supabase.auth.getUser(token);if(error||!data.user)return null;const {data:profile,error:profileError}=await supabase.from("profiles").select("id,role,email,full_name").eq("id",data.user.id).maybeSingle();if(profileError)throw profileError;return profile;}
async function getAbsence(id:string){const {data,error}=await supabase.from("staff_absences").select(`id,staff_record_id,absence_category,start_date,end_date,note,created_by,staff_records!staff_absences_staff_record_id_fkey(profile_id,preferred_name,primary_site,profiles!staff_records_profile_id_fkey(full_name,email))`).eq("id",id).neq("absence_type","annual_leave").maybeSingle();if(error)throw error;if(!data)return null;const staff=first(data.staff_records),profile=first(staff?.profiles);return{id:data.id,staffRecordId:data.staff_record_id,profileId:staff?.profile_id||"",createdBy:data.created_by||"",name:staff?.preferred_name||profile?.full_name||"Staff member",site:staff?.primary_site||"",category:data.absence_category||"other",startDate:data.start_date,endDate:data.end_date,note:data.note||""};}
async function approvalRecipients(staffRecordId:string){const recipients=[{email:notificationTo.toLowerCase(),name:"Luke"}];const {data:lines}=await supabase.from("hr_reporting_lines").select("manager_staff_record_id").eq("staff_record_id",staffRecordId).is("effective_to",null);const ids=(lines||[]).map((row:any)=>row.manager_staff_record_id).filter(Boolean);if(ids.length){const {data:managers}=await supabase.from("staff_records").select("preferred_name,profiles!staff_records_profile_id_fkey(full_name,email)").in("id",ids);for(const row of managers||[]){const profile=first(row.profiles);recipients.push({email:String(profile?.email||"").trim().toLowerCase(),name:row.preferred_name||profile?.full_name||"Manager"});}}const unique=new Map();recipients.filter(item=>item.email.includes("@")).forEach(item=>unique.set(item.email,item));return[...unique.values()];}
async function alreadySent(id:string,email:string){const {data}=await supabase.from("email_logs").select("id").eq("email_type","employee_absence_reported").eq("recipient_email",email).eq("status","sent").contains("metadata",{absenceId:id}).limit(1).maybeSingle();return Boolean(data);}
async function sendEmail(to:string,subject:string,text:string,html:string){const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:resendFrom,to:[to],reply_to:resendReplyTo,subject,text,html})});if(!response.ok)throw new Error(`Email failed with ${response.status}: ${(await response.text()).slice(0,250)}`);return(await response.json().catch(()=>null))?.id||"";}
function categoryLabel(value:string){return({sickness:"Sickness",medical:"Medical appointment or treatment",dependent_emergency:"Dependent or family emergency",bereavement:"Bereavement",unpaid_leave:"Unpaid leave",other:"Other absence"} as Record<string,string>)[value]||"Other absence";}
function dateRange(start:string,end:string){const format=(value:string)=>new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric",timeZone:"Europe/London"});return start===end?format(start):`${format(start)} to ${format(end)}`;}
function firstName(value:string){return String(value||"there").trim().split(/\s+/)[0]||"there";}
function first(value:any){return Array.isArray(value)?value[0]:value;}
function json(payload:unknown,status=200){return new Response(JSON.stringify(payload),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
