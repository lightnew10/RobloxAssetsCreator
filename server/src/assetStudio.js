import { executeStudioTool } from './studioBridge.js';
import { parseStudioMcpResult } from './studioMcpClient.js';
import { traceEvent } from './trace.js';

const clean = (value, n = 45) => String(value || 'Asset').replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, n);
const folderName = (job) => 'RobloxAssetsCreator_' + job.id.slice(0, 8);
const modelName = (job, variant) => 'Asset_' + clean(job.name, 28) + '_V' + (variant.order + 1) + '_' + variant.id.slice(0, 6);

const placement = `local _,wantedSize=model:GetBoundingBox()
local x=0
for _,other in ipairs(folder:GetChildren()) do
  if other:IsA("Model") and other~=model then
    local ok,cf,size=pcall(function() return other:GetBoundingBox() end)
    if ok then x=math.max(x,cf.Position.X+size.X/2+wantedSize.X/2+25) end
  end
end
local cf,size=model:GetBoundingBox()
model:PivotTo(CFrame.new(x-cf.Position.X,size.Y/2-cf.Position.Y,-cf.Position.Z)*model:GetPivot())
cf,size=model:GetBoundingBox()
return HttpService:JSONEncode({path=model:GetFullName(),centerX=cf.Position.X,centerY=cf.Position.Y,centerZ=cf.Position.Z,size={size.X,size.Y,size.Z}})`;

export function buildPartsLuau(job, variant) {
  const payload = { folder: folderName(job), model: modelName(job, variant), parts: variant.geometry.parts, jobId: job.id, variantId: variant.id };
  return `local HttpService=game:GetService("HttpService")
local data=HttpService:JSONDecode(${JSON.stringify(JSON.stringify(payload))})
local folder=workspace:FindFirstChild(data.folder)
if not folder then folder=Instance.new("Folder") folder.Name=data.folder folder.Parent=workspace end
local existing=folder:FindFirstChild(data.model)
if existing then existing:Destroy() end
local model=Instance.new("Model")
model.Name=data.model
model:SetAttribute("RACJobId",data.jobId)
model:SetAttribute("RACVariantId",data.variantId)
for index,spec in ipairs(data.parts) do
  local part=Instance.new(spec.shape=="wedge" and "WedgePart" or "Part")
  part.Name="Part_"..tostring(index)
  part:SetAttribute("DisplayName",spec.name)
  part:SetAttribute("ComponentId",spec.componentId)
  if spec.shape=="ball" then part.Shape=Enum.PartType.Ball elseif spec.shape=="cylinder" then part.Shape=Enum.PartType.Cylinder end
  part.Size=spec.shape=="cylinder" and Vector3.new(spec.size[2],spec.size[1],spec.size[3]) or Vector3.new(spec.size[1],spec.size[2],spec.size[3])
  part.Color=Color3.fromRGB(spec.color[1],spec.color[2],spec.color[3])
  part.Material=Enum.Material[spec.material] or Enum.Material.SmoothPlastic
  part.Anchored=true
  part.CanCollide=spec.canCollide==true
  local cf=CFrame.new(spec.position[1],spec.position[2],spec.position[3])*CFrame.Angles(math.rad(spec.rotation[1]),math.rad(spec.rotation[2]),math.rad(spec.rotation[3]))
  part.CFrame=spec.shape=="cylinder" and cf*CFrame.Angles(0,0,math.rad(90)) or cf
  part.Parent=model
end
model.Parent=folder
${placement}`;
}

export async function buildPartsVariant(job, variant) {
  const result = await executeStudioTool('execute_luau', {
    studio_id: job.studioId,
    datamodel_type: 'Edit',
    code: buildPartsLuau(job, variant),
  }, { runId: job.id, variantId: variant.id, phase: 'build' });
  const parsed = parseStudioMcpResult(result);
  if (!parsed?.path) throw Object.assign(new Error('Studio n’a pas retourné le modèle construit.'), { code: 'STUDIO_BUILD_INVALID', details: parsed });
  return parsed;
}

function partNames(job) {
  const category = String(job.category || '').toLowerCase();
  if (/tree|arbre|palm|cocot|ceris/.test(category + ' ' + job.name)) return 'trunk, roots, main branches, secondary branches, foliage, leaves, fruits or flowers';
  if (/rock|roche|stone|pierre/.test(category + ' ' + job.name)) return 'main rock body, secondary masses, surface details';
  if (/house|building|maison|batiment/.test(category + ' ' + job.name)) return 'walls, roof, doorway, windows, structural details';
  return 'main body, structural parts, visible details';
}

function nativePrompt(job, variant) {
  const essentials = (job.plan?.essentialCriteria || []).join('; ');
  return `${job.brief}. Style: ${job.style || 'stylized Roblox'}. Variation ${variant.profile.label}: ${variant.profile.instruction}. Essential visual criteria: ${essentials}. Clean static Roblox asset, coherent proportions, separated readable parts, no text, no scripts.`;
}

function nativeMoveCode(job, variant, source) {
  const payload = { source, folder: folderName(job), name: modelName(job, variant), jobId: job.id, variantId: variant.id };
  return `local HttpService=game:GetService("HttpService")
local data=HttpService:JSONDecode(${JSON.stringify(JSON.stringify(payload))})
local model=game
for segment in string.gmatch(data.source,"[^%.]+") do if segment~="game" then model=model and model:FindFirstChild(segment) end end
if not model then return HttpService:JSONEncode({error="MODEL_NOT_FOUND"}) end
if model:IsA("BasePart") then local wrapper=Instance.new("Model") model.Parent=wrapper model=wrapper end
if not model:IsA("Model") then return HttpService:JSONEncode({error="MODEL_INVALID"}) end
local folder=workspace:FindFirstChild(data.folder)
if not folder then folder=Instance.new("Folder") folder.Name=data.folder folder.Parent=workspace end
model.Name=data.name
model:SetAttribute("RACJobId",data.jobId)
model:SetAttribute("RACVariantId",data.variantId)
model.Parent=folder
${placement}`;
}
function nativeTagMoveCode(job, variant, tag) {
  const payload = { tag, folder: folderName(job), name: modelName(job, variant), jobId: job.id, variantId: variant.id };
  return `local HttpService=game:GetService("HttpService")
local data=HttpService:JSONDecode(${JSON.stringify(JSON.stringify(payload))})
local tagged=game:GetService("CollectionService"):GetTagged(data.tag)
local model=tagged[1]
if not model then return HttpService:JSONEncode({error="MODEL_NOT_FOUND"}) end
if model:IsA("BasePart") then local wrapper=Instance.new("Model") model.Parent=wrapper model=wrapper end
if not model:IsA("Model") then return HttpService:JSONEncode({error="MODEL_INVALID"}) end
local folder=workspace:FindFirstChild(data.folder)
if not folder then folder=Instance.new("Folder") folder.Name=data.folder folder.Parent=workspace end
model.Name=data.name
model:SetAttribute("RACJobId",data.jobId)
model:SetAttribute("RACVariantId",data.variantId)
model.Parent=folder
${placement}`;
}

export function describeNativeFailure(finished, method, jobId) {
  const result = finished?.jobResult?.structuredContent || finished?.jobResult || null;
  const values = [
    finished?.error?.message, finished?.error, finished?.message, finished?.reason,
    finished?.failureReason, finished?.errorMessage, result?.error?.message, result?.error,
    result?.message, result?.reason, result?.failureReason,
  ];
  const reason = values.find((value) => typeof value === 'string' && value.trim()) || null;
  return {
    method, jobId, status: String(finished?.status || 'unknown'),
    reason, providerDetailsAvailable: Boolean(reason),
    // The full MCP response is already saved by executeStudioTool as a separate trace artifact.
  };
}

export async function buildNativeVariant(job, variant, { methodOverride = null } = {}) {
  const method = methodOverride || (job.plan?.nativeMethod === 'generate_mesh' ? 'generate_mesh' : 'generate_procedural_model');
  const size = job.plan?.sizeStuds;
  const args = method === 'generate_mesh'
    ? { studio_id: job.studioId, textPrompt: nativePrompt(job, variant), segmentation: 'explicit', partNames: partNames(job), ...(size ? { size: { x: size[0], y: size[1], z: size[2] } } : {}), maxTriangles: 12000, async: true }
    : { studio_id: job.studioId, prompt: nativePrompt(job, variant), segmentation: 'explicit', partNames: partNames(job), async: true };
  const started = parseStudioMcpResult(await executeStudioTool(method, args, { runId: job.id, variantId: variant.id, phase: 'native_generation' }));
  if (!started?.jobId) throw Object.assign(new Error('Roblox n’a pas retourné de jobId pour la génération native.'), { code: 'NATIVE_JOB_INVALID', details: started });
  const finished = parseStudioMcpResult(await executeStudioTool('wait_job_finished', { studio_id: job.studioId, jobId: started.jobId, timeout: 600 }, { runId: job.id, variantId: variant.id, phase: 'native_generation' }));
  const diagnostic = describeNativeFailure(finished, method, started.jobId);
  await traceEvent(job.id, 'NATIVE_GENERATION_RESULT', diagnostic, { phase: 'native_generation', variantId: variant.id });
  if (finished?.status !== 'Completed') {
    const reason = diagnostic.reason || 'Roblox/MCP ne fournit aucune cause détaillée dans le résultat du job.';
    throw Object.assign(new Error('Génération native Roblox : ' + diagnostic.status + ' · ' + reason), {
      code: 'NATIVE_GENERATION_FAILED', details: { ...diagnostic, response: finished },
    });
  }
  const details = finished.jobResult?.structuredContent || parseStudioMcpResult(finished.jobResult);
  const tag = typeof details?.tag === 'string' ? details.tag : null;
  const source = typeof (details?.modelPath || details?.path || details?.instancePath) === 'string' ? (details.modelPath || details.path || details.instancePath) : null;
  if (!tag && !source) throw Object.assign(new Error('Le modèle natif Roblox n’est pas localisable.'), { code: 'NATIVE_RESULT_INVALID', details });
  const code = source ? nativeMoveCode(job, variant, source) : nativeTagMoveCode(job, variant, tag);
  const moved = parseStudioMcpResult(await executeStudioTool('execute_luau', { studio_id: job.studioId, datamodel_type: 'Edit', code }, { runId: job.id, variantId: variant.id, phase: 'native_place' }));
  if (!moved?.path) throw Object.assign(new Error('Impossible de déplacer le modèle natif dans la zone de review.'), { code: 'NATIVE_PLACE_FAILED', details: moved });
  return { ...moved, nativeJobId: started.jobId, nativeMethod: method };
}

export function technicalAuditLuau(job, variant) {
  const payload = { folder: folderName(job), model: modelName(job, variant) };
  return `local HttpService=game:GetService("HttpService")
local data=HttpService:JSONDecode(${JSON.stringify(JSON.stringify(payload))})
local folder=workspace:FindFirstChild(data.folder)
local model=folder and folder:FindFirstChild(data.model)
if not model then return HttpService:JSONEncode({found=false}) end
local parts,anchored,collidable,meshes=0,0,0,0
local materials={}
for _,item in ipairs(model:GetDescendants()) do
  if item:IsA("BasePart") then
    parts+=1
    if item.Anchored then anchored+=1 end
    if item.CanCollide then collidable+=1 end
    if item:IsA("MeshPart") then meshes+=1 end
    materials[item.Material.Name]=(materials[item.Material.Name] or 0)+1
  end
end
local cf,size=model:GetBoundingBox()
return HttpService:JSONEncode({found=true,partCount=parts,anchoredCount=anchored,collidableCount=collidable,meshCount=meshes,size={size.X,size.Y,size.Z},center={cf.Position.X,cf.Position.Y,cf.Position.Z},materials=materials})`;
}

export async function auditVariant(job, variant) {
  const parsed = parseStudioMcpResult(await executeStudioTool('execute_luau', {
    studio_id: job.studioId, datamodel_type: 'Edit', code: technicalAuditLuau(job, variant),
  }, { runId: job.id, variantId: variant.id, phase: 'technical_audit' }));
  const failures = [];
  if (!parsed?.found || parsed.partCount < 1) failures.push('model_missing_or_empty');
  if (parsed?.partCount > 0 && parsed.anchoredCount !== parsed.partCount) failures.push('unanchored_parts');
  if (!Array.isArray(parsed?.size) || parsed.size.some((x) => !Number.isFinite(x) || x <= 0)) failures.push('invalid_bounds');
  return { ...parsed, passed: failures.length === 0, failures };
}

export async function saveVariantToLibrary(job, variant) {
  const payload = { folder: folderName(job), model: modelName(job, variant), category: clean(job.category || 'Autres', 40), type: clean(job.name, 55), assetName: clean(job.name, 45) + '_' + variant.id.slice(0, 8), variantId: variant.id };
  const code = `local HttpService=game:GetService("HttpService")
local data=HttpService:JSONDecode(${JSON.stringify(JSON.stringify(payload))})
local sourceFolder=workspace:FindFirstChild(data.folder)
local source=sourceFolder and sourceFolder:FindFirstChild(data.model)
if not source then return HttpService:JSONEncode({error="SOURCE_NOT_FOUND"}) end
local storage=game:GetService("ServerStorage")
local library=storage:FindFirstChild("RobloxAssetsCreator_Assets")
if not library then library=Instance.new("Folder") library.Name="RobloxAssetsCreator_Assets" library.Parent=storage end
local category=library:FindFirstChild(data.category)
if not category then category=Instance.new("Folder") category.Name=data.category category.Parent=library end
local kind=category:FindFirstChild(data.type)
if not kind then kind=Instance.new("Folder") kind.Name=data.type kind.Parent=category end
local existing=kind:FindFirstChild(data.assetName)
if existing then existing:Destroy() end
local saved=source:Clone()
saved.Name=data.assetName
saved:SetAttribute("RACVariantId",data.variantId)
saved.Parent=kind
return HttpService:JSONEncode({path=saved:GetFullName(),name=saved.Name})`;
  return parseStudioMcpResult(await executeStudioTool('execute_luau', { studio_id: job.studioId, datamodel_type: 'Edit', code }, { runId: job.id, variantId: variant.id, phase: 'save' }));
}
