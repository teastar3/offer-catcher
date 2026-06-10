/* ============================================================
   Offer 捕手 — AI Engine
   LLMClient · ResumeParser · Matcher · GreetingGenerator
   ============================================================ */

// ────────────────────────────────────────
//  LLM Client  (OpenAI-Compatible)
// ────────────────────────────────────────
class LLMClient {
  #baseUrl; #apiKey; #model;

  constructor({ baseUrl = '', apiKey = '', model = '' } = {}) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#apiKey  = apiKey;
    this.#model   = model;
  }

  get isConfigured() {
    return !!(this.#baseUrl && this.#apiKey && this.#model);
  }

  async chat(messages, { temperature = 0.7, maxTokens = 2048, jsonMode = false } = {}) {
    const body = { model: this.#model, messages, temperature, max_tokens: maxTokens };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  async testConnection() {
    try {
      const reply = await this.chat(
        [{ role: 'user', content: '请回复"OK"两个字母，不要输出其他内容。' }],
        { maxTokens: 10, temperature: 0 }
      );
      return { success: true, reply: reply.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// ────────────────────────────────────────
//  Resume Parser
// ────────────────────────────────────────
class ResumeParser {

  /** 从文件提取纯文本 */
  static async extractText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') return this.#extractPDF(file);
    if (ext === 'docx' || ext === 'doc') return this.#extractDOCX(file);
    throw new Error('仅支持 PDF / DOCX 格式');
  }

  static async #extractPDF(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js 库未加载');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text.trim();
  }

  static async #extractDOCX(file) {
    if (typeof mammoth === 'undefined') throw new Error('mammoth.js 库未加载');
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value.trim();
  }

  /** 完整解析：提取文本 → LLM 结构化 */
  static async parse(file, llmClient, onProgress) {
    onProgress?.('正在提取文本…');
    const text = await this.extractText(file);
    if (!text || text.length < 20) throw new Error('无法从简历中提取到有效文本');

    onProgress?.('AI 正在分析简历…');

    const systemPrompt = `你是专业的简历解析助手。将简历文本解析为严格 JSON。
输出格式：
{
  "name":"姓名","phone":"手机","email":"邮箱",
  "education":[{"school":"","degree":"","major":"","gpa":"","startDate":"","endDate":""}],
  "skills":["技能1","技能2"],
  "experience":[{"company":"","title":"","startDate":"","endDate":"","description":""}],
  "projects":[{"name":"","description":"","techStack":[]}],
  "internships":[{"company":"","title":"","startDate":"","endDate":"","description":""}],
  "targetPosition":"目标岗位","targetCity":"目标城市",
  "summary":"候选人核心竞争力概述(50字内)"
}
规则：缺失字段返回空字符串或空数组。不要编造。skills 提取所有技术栈/工具/语言。`;

    const raw = await llmClient.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `请解析以下简历：\n\n${text.slice(0, 6000)}` },
    ], { temperature: 0.1, jsonMode: true });

    try { return JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  }
}

// ────────────────────────────────────────
//  Matcher — 批量匹配打分
// ────────────────────────────────────────
class Matcher {

  /**
   * @param {Object}   resume      - 结构化简历
   * @param {Array}    jobs        - 岗位数组
   * @param {LLMClient} llmClient
   * @param {Function} onProgress  - (message, completedCount) => void
   * @returns {Promise<Array>} 匹配结果
   */
  static async batchMatch(resume, jobs, llmClient, onProgress) {
    const BATCH = 5;
    const results = [];
    const total = Math.ceil(jobs.length / BATCH);

    const resumeContext = JSON.stringify({
      summary: resume.summary,
      skills: resume.skills,
      education: resume.education?.map(e => `${e.school} ${e.degree} ${e.major}`),
      experience: resume.experience?.map(e => `${e.company} ${e.title}: ${e.description}`),
      internships: resume.internships?.map(e => `${e.company} ${e.title}: ${e.description}`),
      targetPosition: resume.targetPosition,
      targetCity: resume.targetCity,
    }, null, 2);

    for (let i = 0; i < jobs.length; i += BATCH) {
      const batch = jobs.slice(i, i + BATCH);
      const batchNum = Math.floor(i / BATCH) + 1;
      onProgress?.(`匹配中 ${batchNum}/${total}`, results.length);

      const systemPrompt = `你是资深猎头，评估候选人与岗位的匹配度。
候选人：${resumeContext}
打分维度(满分100)：技能40% + 经验30% + 学历15% + 地域15%
matchLevel：≥75 "高匹配"，60-74 "中匹配"，<60 "低匹配"
action：≥75 "推荐投递"，60-74 "可以尝试"，<60 "暂不推荐"
输出JSON：{"results":[{"jobIndex":0,"matchScore":85,"matchLevel":"高匹配","strengths":[],"gaps":[],"suggestionBrief":"","action":"推荐投递"}]}`;

      const userContent = batch.map((j, idx) =>
        `[${idx}] ${j.title} | ${j.company} | ${j.salary} | ${j.location} | ${j.experience} ${j.education} | ${(j.tags||[]).join(',')}`
      ).join('\n');

      try {
        const raw = await llmClient.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ], { temperature: 0.3, jsonMode: true, maxTokens: 2048 });

        let parsed;
        try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }

        if (parsed?.results) {
          parsed.results.forEach((r, idx) => {
            results.push({
              ...batch[idx],
              matchScore: r.matchScore ?? 0,
              matchLevel: r.matchLevel ?? '低匹配',
              strengths:  r.strengths  ?? [],
              gaps:       r.gaps       ?? [],
              suggestionBrief: r.suggestionBrief ?? '',
              action:     r.action     ?? '暂不推荐',
            });
          });
        }
      } catch (err) {
        console.error(`Batch ${batchNum} error:`, err);
        batch.forEach(j => results.push({
          ...j, matchScore: 0, matchLevel: '未匹配',
          strengths: [], gaps: ['匹配过程出错'], suggestionBrief: '', action: '未知',
        }));
      }

      if (i + BATCH < jobs.length) await new Promise(r => setTimeout(r, 800));
    }

    results.sort((a, b) => b.matchScore - a.matchScore);
    onProgress?.('匹配完成', results.length);
    return results;
  }
}

// ────────────────────────────────────────
//  Greeting Generator
// ────────────────────────────────────────
class GreetingGenerator {

  static async generate(resume, job, llmClient) {
    const sys = `你是求职顾问，为候选人撰写 Boss 直聘打招呼消息。
要求：100-200字，简述2-3个核心优势匹配点，语气专业有亲和力，只输出招呼内容不要多余说明。`;

    const usr = `候选人：${resume.summary}
技能：${resume.skills?.join('、')}
经历：${[...(resume.experience||[]),...(resume.internships||[])].map(e=>`${e.title}@${e.company}`).join('、')}

岗位：${job.title} @ ${job.company}  薪资:${job.salary}
要求：${job.experience} ${job.education}
标签：${(job.tags||[]).join('、')}
匹配优势：${(job.strengths||[]).join('、')}`;

    return (await llmClient.chat([
      { role: 'system', content: sys },
      { role: 'user',   content: usr },
    ], { temperature: 0.8, maxTokens: 500 })).trim();
  }
}

// ────────────────────────────────────────
//  Export
// ────────────────────────────────────────
window.LLMClient         = LLMClient;
window.ResumeParser      = ResumeParser;
window.Matcher           = Matcher;
window.GreetingGenerator = GreetingGenerator;
