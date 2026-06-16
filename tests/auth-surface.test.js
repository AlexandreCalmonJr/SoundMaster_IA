import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appServerSrc = readFileSync(resolve(process.cwd(), 'src/server/app-server.js'), 'utf8');
const authServiceSrc = readFileSync(resolve(process.cwd(), 'frontend/js/services/auth.service.js'), 'utf8');

describe('Auth surface tightening', () => {
    it('protects ai health and diagnose routes with authenticateToken', () => {
        expect(appServerSrc).toContain("expressApp.get('/api/ai/health', authenticateToken, async (req, res) => {");
        expect(appServerSrc).toContain("expressApp.get('/api/ai/diagnose', authenticateToken, async (req, res) => {");
    });

    it('propagates Python diagnose and proxy status codes through the shared helper', () => {
        expect(appServerSrc).toContain('async function callPythonJson({');
        expect(appServerSrc).toContain('res.status(response.status).json(data);');
        expect(appServerSrc).toContain("pythonPath: '/diagnose'");
        expect(appServerSrc).toContain("pythonPath: '/acoustic_analysis'");
        expect(appServerSrc).toContain("pythonPath: '/hardware_diagnosis'");
        expect(appServerSrc).toContain("pythonPath: '/train'");
        expect(appServerSrc).toContain("const { response, data } = await _proxyAIModel('GET', '/api/models');");
    });

    it('does not treat arbitrary localStorage blobs as authenticated users', () => {
        expect(authServiceSrc).toContain("return !!(user && typeof user === 'object' && user.id);");
    });
});
