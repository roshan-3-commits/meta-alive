import { MedicalReport } from '../types';

/**
 * Client-Side Gemini AI Analyzer
 * Enables live multimodal report extraction directly in the browser on GitHub Pages!
 */

const GEMINI_STORAGE_KEY = 'user_gemini_api_key';

export function getClientGeminiKey(): string {
  // Check localStorage first, then Vite build-time env
  const stored = typeof window !== 'undefined' ? localStorage.getItem(GEMINI_STORAGE_KEY) : '';
  if (stored && stored.trim()) return stored.trim();

  const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim()) return envKey.trim();

  return '';
}

export function setClientGeminiKey(key: string): void {
  if (typeof window !== 'undefined') {
    if (key && key.trim()) {
      localStorage.setItem(GEMINI_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(GEMINI_STORAGE_KEY);
    }
  }
}

export async function analyzeReportWithClientGemini(params: {
  apiKey: string;
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
}): Promise<MedicalReport> {
  const { apiKey, text, imageBase64, mimeType, fileName } = params;

  if (!apiKey) {
    throw new Error('No Gemini API Key provided.');
  }

  const cleanKey = apiKey.trim();

  // Prepare parts
  const parts: any[] = [];

  if (imageBase64) {
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: cleanBase64,
      },
    });
  }

  const promptText = `
You are MedInsight AI, a board-certified clinical pathologist and laboratory diagnostics specialist.
Analyze this medical diagnostic lab report. Extract ALL clinical biomarkers with 100% precision from the document.

Rules:
1. Extract patient details exactly as written on the report (name, age, gender, report type, date, doctor, lab). If not listed, do not invent; infer sensible defaults based on visible cues.
2. Extract all distinct lab tests found in the report. For each test:
   - name: clear clinical biomarker name (e.g. "Hemoglobin", "Total Cholesterol", "Blood Sugar (Fasting)", "Platelet Count")
   - category: one of 'Hematology', 'Biochemistry', 'Lipid Profile', 'Thyroid', 'Vitamins & Minerals', 'Metabolic', 'Other'
   - resultValue: exact observed string result from the document (e.g. "12.4")
   - numericValue: numeric float representation if quantifiable (e.g. 12.4)
   - unit: e.g. "g/dL", "mg/dL", "ng/mL", "%"
   - referenceRange: object with { min?: number, max?: number, text: "reference interval string" }
   - status: evaluate accurately against reference range -> 'normal' | 'low' | 'high' | 'critical'
   - description: brief clinical definition
   - clinicalSignificance: clinical implication of the result
   - simpleExplanation: plain-language explanation an average patient can easily understand
   - recommendations: 2-3 specific dietary/lifestyle steps
3. Provide an overall health summary with:
   - overallHealthStatus: 'Optimal' | 'Borderline Attention Needed' | 'Clinical Follow-up Advised' | 'Critical Review Required'
   - headline: clear, professional 1-sentence assessment based on observed findings
   - keyFindings: array of key abnormal or critical findings
   - dietaryRecommendations: specific foods to add or avoid
   - lifestyleModifications: exercise, sleep, hydration
   - doctorFollowUpQuestions: 3-4 questions the patient should ask their doctor
   - medicalDisclaimer: "MedInsight AI is an informational clinical decision support and health-literacy tool. It does not provide medical diagnosis or replace consultation with a qualified medical professional."

${text ? `Raw input text:\n"""${text}"""` : ''}

Respond ONLY with a valid JSON object strictly matching this schema:
{
  "patientInfo": {
    "name": "string",
    "age": 28,
    "gender": "Male" | "Female" | "Other",
    "reportType": "string",
    "reportDate": "string",
    "referringDoctor": "string",
    "labName": "string",
    "specimenId": "string"
  },
  "tests": [
    {
      "id": "string",
      "name": "string",
      "category": "string",
      "resultValue": "string",
      "numericValue": 10.5,
      "unit": "string",
      "referenceRange": { "min": 12, "max": 16, "unit": "g/dL", "text": "12.0 - 16.0 g/dL" },
      "status": "normal" | "low" | "high" | "critical",
      "description": "string",
      "clinicalSignificance": "string",
      "simpleExplanation": "string",
      "recommendations": ["string"]
    }
  ],
  "summary": {
    "overallHealthStatus": "Clinical Follow-up Advised",
    "headline": "string",
    "normalCount": 0,
    "abnormalCount": 0,
    "criticalCount": 0,
    "keyFindings": [{ "testName": "string", "status": "string", "summary": "string" }],
    "dietaryRecommendations": ["string"],
    "lifestyleModifications": ["string"],
    "doctorFollowUpQuestions": ["string"],
    "medicalDisclaimer": "string"
  }
}
`;

  parts.push({ text: promptText });

  // Candidate models (Gemini 2.5 Flash / 1.5 Flash) supported by the v1beta API
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const errMsg = errJson?.error?.message || `HTTP ${response.status} from Gemini API`;
        throw new Error(errMsg);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('Gemini API returned an empty response.');
      }

      const parsed = JSON.parse(rawText);

      // Validate and compute summary counts
      let normal = 0;
      let abnormal = 0;
      let critical = 0;

      const tests = (parsed.tests || []).map((t: any, index: number) => {
        const id = t.id || `TEST-${index + 1}`;
        const status = t.status || 'normal';
        if (status === 'normal') normal++;
        else if (status === 'critical') critical++;
        else abnormal++;

        return {
          ...t,
          id,
          status,
        };
      });

      const report: MedicalReport = {
        id: `REP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        patientInfo: {
          name: parsed.patientInfo?.name || 'Patient',
          age: parsed.patientInfo?.age || 30,
          gender: parsed.patientInfo?.gender || 'Male',
          reportType: parsed.patientInfo?.reportType || 'Complete Laboratory Report',
          reportDate: parsed.patientInfo?.reportDate || new Date().toLocaleDateString('en-GB'),
          referringDoctor: parsed.patientInfo?.referringDoctor || 'Dr. Consultant Physician',
          labName: parsed.patientInfo?.labName || 'Clinical Diagnostic Laboratory',
          specimenId: parsed.patientInfo?.specimenId || `SP-${Math.floor(100000 + Math.random() * 900000)}`,
        },
        tests,
        summary: {
          ...parsed.summary,
          normalCount: normal,
          abnormalCount: abnormal,
          criticalCount: critical,
          overallHealthStatus: parsed.summary?.overallHealthStatus || (abnormal > 0 ? 'Clinical Follow-up Advised' : 'Optimal'),
          headline: parsed.summary?.headline || `Comprehensive lab panel evaluated with ${normal} normal and ${abnormal + critical} flagged parameters.`,
        },
        createdAt: new Date().toISOString(),
        fileName: fileName || 'Uploaded_Medical_Report.pdf',
        fileType: mimeType || 'application/pdf',
        rawText: text,
        isDemo: false,
      };

      return report;
    } catch (err: any) {
      lastError = err;
      console.warn(`Attempt with ${model} failed, trying next candidate:`, err);
    }
  }

  throw lastError || new Error('Failed to analyze report with Gemini AI.');
}
