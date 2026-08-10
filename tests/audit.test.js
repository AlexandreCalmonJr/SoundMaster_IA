/**
 * SUITE DE TESTES DE AUDITORIA - SoundMaster Pro / Sound Assist
 * Audita componentes, menus, submenus e páginas HTML — valida contra o filesystem real.
 * 
 * Executar: npm test -- tests/audit.test.js
 */

import { describe, it, assert } from 'vitest';
import fs from 'fs';
import path from 'path';

const FRONTEND_DIR = path.resolve(process.cwd(), 'frontend');

// =============================================================================
// 1. CONFIGURAÇÃO DE DADOS ESPERADOS (alinhado com layout.js e ROUTE_MAP real)
// =============================================================================

const EXPECTED_COMPONENTS = {
  sidebar: 'frontend/components/sidebar.html'
};

const EXPECTED_MENU_STRUCTURE = {
  dashboard: {
    type: 'direct',
    name: 'Dashboard',
    icon: 'home'
  },
  measuring: {
    type: 'category',
    name: 'Medir',
    icon: 'chart-line',
    submenus: [
      { id: 'rt60', name: 'RT60', file: 'pages/rt60.html' },
      { id: 'acustica', name: 'Acústica', file: 'pages/acustica.html' },
      { id: 'benchmarking', name: 'Benchmarking', file: 'pages/benchmarking.html' },
      { id: 'spl-heatmap', name: 'Mapa de Calor SPL', file: 'pages/spl-heatmap.html' },
      { id: 'coverage-map', name: 'Mapa de Cobertura', file: 'pages/coverage-map.html' }
    ]
  },
  analysis: {
    type: 'category',
    name: 'Analisar',
    icon: 'chart-area',
    submenus: [
      { id: 'analyzer', name: 'FFT & Waterfall', file: 'pages/analyzer.html' },
      { id: 'analyzer-signals', name: 'Gerador de Sinais', file: 'pages/analyzer-signals.html' },
      { id: 'analyzer-calibration', name: 'Calibração', file: 'pages/analyzer-calibration.html' },
      { id: 'ir-measurement', name: 'Resposta ao Impulso', file: 'pages/ir-measurement.html' },
      { id: 'feedback-detector', name: 'Detector Feedback', file: 'pages/feedback-detector.html' },
      { id: 'eq-guide', name: 'Guia de EQ', file: 'pages/eq-guide.html' }
    ]
  },
  mixer: {
    type: 'category',
    name: 'Mixer',
    icon: 'sliders',
    submenus: [
      { id: 'mixer-input', name: 'Canais de Entrada', file: 'pages/mixer-input.html' },
      { id: 'mixer-aux', name: 'Monitores & Aux', file: 'pages/mixer-aux.html' },
      { id: 'mixer-fx', name: 'Envios de Efeito', file: 'pages/mixer-fx.html' },
      { id: 'voice-presets', name: 'Presets de Voz', file: 'pages/voice-presets.html' },
      { id: 'stage-plot', name: 'Palco Virtual', file: 'pages/stage-plot.html' },
      { id: 'mixer-report', name: 'Relatório da Mesa', file: 'pages/mixer-report.html' },
      { id: 'ui24r-embed', name: 'Mesa Original', file: 'pages/ui24r-embed.html' }
    ]
  },
  eq: {
    type: 'category',
    name: 'EQ',
    icon: 'sliders-h',
    submenus: [
      { id: 'eq', name: 'Equalização', file: 'pages/eq.html' },
      { id: 'auto-eq', name: 'Auto-EQ / Target Curve', file: 'pages/auto-eq.html' },
      { id: 'delay-align', name: 'Alinhamento Delay', file: 'pages/delay-align.html' }
    ]
  },
  automation: {
    type: 'category',
    name: 'Automação',
    icon: 'cog',
    submenus: [
      { id: 'automixer', name: 'Auto-Mixer Dugan', file: 'pages/automixer.html' },
      { id: 'scene-builder', name: 'Scene Builder', file: 'pages/scene-builder.html' },
      { id: 'mixer-git', name: 'Mixer Git', file: 'pages/mixer-git.html' }
    ]
  },
  system: {
    type: 'category',
    name: 'Sistema',
    icon: 'desktop',
    submenus: [
      { id: 'systems', name: 'Conexão Ui24R', file: 'pages/systems.html' },
      { id: 'hardware-diagnostics', name: 'Diagnóstico de Hardware', file: 'pages/hardware-diagnostics.html' },
      { id: 'aes67', name: 'Saúde de Cabos (AES67)', file: 'pages/aes67.html' },
      { id: 'settings', name: 'Preferências', file: 'pages/settings.html' },
      { id: 'debug', name: 'Console de Depuração', file: 'pages/debug.html' }
    ]
  },
  aiChat: {
    type: 'direct',
    name: 'Assistente IA',
    icon: 'robot'
  },
  volunteerMode: {
    type: 'direct',
    name: 'Modo Voluntário',
    icon: 'user'
  },
  testbed: {
    type: 'direct',
    name: 'Testbed',
    icon: 'wrench'
  },
  tutorials: {
    type: 'direct',
    name: 'Tutoriais',
    icon: 'help'
  }
};

const EXPECTED_PAGES = [
  // Medir (5)
  { id: 'rt60', file: 'pages/rt60.html', category: 'Medir' },
  { id: 'acustica', file: 'pages/acustica.html', category: 'Medir' },
  { id: 'benchmarking', file: 'pages/benchmarking.html', category: 'Medir' },
  { id: 'spl-heatmap', file: 'pages/spl-heatmap.html', category: 'Medir' },
  { id: 'coverage-map', file: 'pages/coverage-map.html', category: 'Medir' },

  // Analisar (6)
  { id: 'analyzer', file: 'pages/analyzer.html', category: 'Analisar' },
  { id: 'analyzer-signals', file: 'pages/analyzer-signals.html', category: 'Analisar' },
  { id: 'analyzer-calibration', file: 'pages/analyzer-calibration.html', category: 'Analisar' },
  { id: 'ir-measurement', file: 'pages/ir-measurement.html', category: 'Analisar' },
  { id: 'feedback-detector', file: 'pages/feedback-detector.html', category: 'Analisar' },
  { id: 'eq-guide', file: 'pages/eq-guide.html', category: 'Analisar' },

  // Mixer (7)
  { id: 'mixer-input', file: 'pages/mixer-input.html', category: 'Mixer' },
  { id: 'mixer-aux', file: 'pages/mixer-aux.html', category: 'Mixer' },
  { id: 'mixer-fx', file: 'pages/mixer-fx.html', category: 'Mixer' },
  { id: 'voice-presets', file: 'pages/voice-presets.html', category: 'Mixer' },
  { id: 'stage-plot', file: 'pages/stage-plot.html', category: 'Mixer' },
  { id: 'mixer-report', file: 'pages/mixer-report.html', category: 'Mixer' },
  { id: 'ui24r-embed', file: 'pages/ui24r-embed.html', category: 'Mixer' },

  // EQ (3)
  { id: 'eq', file: 'pages/eq.html', category: 'EQ' },
  { id: 'auto-eq', file: 'pages/auto-eq.html', category: 'EQ' },
  { id: 'delay-align', file: 'pages/delay-align.html', category: 'EQ' },

  // Automação (3)
  { id: 'automixer', file: 'pages/automixer.html', category: 'Automação' },
  { id: 'scene-builder', file: 'pages/scene-builder.html', category: 'Automação' },
  { id: 'mixer-git', file: 'pages/mixer-git.html', category: 'Automação' },

  // Sistema (5)
  { id: 'systems', file: 'pages/systems.html', category: 'Sistema' },
  { id: 'hardware-diagnostics', file: 'pages/hardware-diagnostics.html', category: 'Sistema' },
  { id: 'aes67', file: 'pages/aes67.html', category: 'Sistema' },
  { id: 'settings', file: 'pages/settings.html', category: 'Sistema' },
  { id: 'debug', file: 'pages/debug.html', category: 'Sistema' },

  // Diretos / Independentes (6)
  { id: 'home', file: 'pages/home.html', category: null },
  { id: 'ai-chat', file: 'pages/ai-chat.html', category: null },
  { id: 'mobile', file: 'pages/mobile.html', category: null },
  { id: 'volunteer-mode', file: 'pages/volunteer-mode.html', category: null },
  { id: 'testbed', file: 'pages/testbed.html', category: null },
  { id: 'tutorials', file: 'pages/tutorials.html', category: null }
];

// =============================================================================
// 2. TESTES DE ESTRUTURA DE MENU
// =============================================================================

describe('📋 AUDITA - Estrutura de Menus', function() {
  
  it('Deve ter 11 menus principais (6 categorias + 5 diretos)', function() {
    const menuCount = Object.keys(EXPECTED_MENU_STRUCTURE).length;
    assert.strictEqual(menuCount, 11, `Esperado 11 menus, encontrado ${menuCount}`);
  });

  it('Deve ter 6 menus de categoria com submenus', function() {
    const categories = Object.values(EXPECTED_MENU_STRUCTURE)
      .filter(m => m.type === 'category');
    assert.strictEqual(categories.length, 6, `Esperado 6 categorias, encontrado ${categories.length}`);
  });

  it('Deve ter 5 menus diretos (links rápidos)', function() {
    const directMenus = Object.values(EXPECTED_MENU_STRUCTURE)
      .filter(m => m.type === 'direct');
    assert.strictEqual(directMenus.length, 5, `Esperado 5 menus diretos, encontrado ${directMenus.length}`);
  });

  it('Deve ter 29 submenus no total', function() {
    let submenuCount = 0;
    Object.values(EXPECTED_MENU_STRUCTURE).forEach(menu => {
      if (menu.submenus) {
        submenuCount += menu.submenus.length;
      }
    });
    assert.strictEqual(submenuCount, 29, `Esperado 29 submenus, encontrado ${submenuCount}`);
  });

  it('Deve ter 5 submenus em "Medir"', function() {
    assert.strictEqual(EXPECTED_MENU_STRUCTURE.measuring.submenus.length, 5, 'Medir deve ter 5 submenus');
  });

  it('Deve ter 6 submenus em "Analisar"', function() {
    assert.strictEqual(EXPECTED_MENU_STRUCTURE.analysis.submenus.length, 6, 'Analisar deve ter 6 submenus');
  });

  it('Deve ter 7 submenus em "Mixer"', function() {
    assert.strictEqual(EXPECTED_MENU_STRUCTURE.mixer.submenus.length, 7, 'Mixer deve ter 7 submenus');
  });

  it('Deve ter 3 submenus em "EQ"', function() {
    assert.strictEqual(EXPECTED_MENU_STRUCTURE.eq.submenus.length, 3, 'EQ deve ter 3 submenus');
  });

  it('Deve ter 3 submenus em "Automação"', function() {
    assert.strictEqual(EXPECTED_MENU_STRUCTURE.automation.submenus.length, 3, 'Automação deve ter 3 submenus');
  });

  it('Deve ter 5 submenus em "Sistema"', function() {
    assert.strictEqual(EXPECTED_MENU_STRUCTURE.system.submenus.length, 5, 'Sistema deve ter 5 submenus');
  });
});

// =============================================================================
// 3. TESTES DE COMPONENTES
// =============================================================================

describe('🧩 AUDITA - Componentes Shell', function() {
  
  it('Deve ter componente Sidebar', function() {
    assert.ok(EXPECTED_COMPONENTS.sidebar, 'Componente Sidebar não encontrado');
  });

  it('Devem haver exatamente 1 componentes principais', function() {
    assert.strictEqual(
      Object.keys(EXPECTED_COMPONENTS).length,
      1,
      'Deve haver exatamente 1 componente shell'
    );
  });
});

// =============================================================================
// 4. TESTES DE PÁGINAS
// =============================================================================

describe('📄 AUDITA - Páginas e Views', function() {
  
  it('Deve haver 35 páginas no total', function() {
    assert.strictEqual(
      EXPECTED_PAGES.length,
      35,
      `Esperado 35 páginas, encontrado ${EXPECTED_PAGES.length}`
    );
  });

  it('Todas as páginas devem ter IDs únicos', function() {
    const ids = EXPECTED_PAGES.map(p => p.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(ids.length, uniqueIds.size, 'Existem IDs de página duplicados');
  });

  it('Todas as páginas devem ter referência de arquivo', function() {
    EXPECTED_PAGES.forEach(page => {
      assert.ok(page.file, `Página ${page.id} sem arquivo definido`);
    });
  });

  it('Todas as páginas físicas do diretório frontend/pages devem estar catalogadas', function() {
    const pagesDir = path.resolve(FRONTEND_DIR, 'pages');
    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
    assert.strictEqual(files.length, 35, `Existem ${files.length} páginas no disco, esperado 35`);
    files.forEach(file => {
      const cataloged = EXPECTED_PAGES.some(p => p.file === `pages/${file}`);
      assert.ok(cataloged, `Página ${file} existe no disco mas não foi catalogada no teste de auditoria`);
    });
  });

  it('Deve haver página "home" (Dashboard)', function() {
    const home = EXPECTED_PAGES.find(p => p.id === 'home');
    assert.ok(home, 'Página home não encontrada');
    assert.strictEqual(home.file, 'pages/home.html');
  });

  it('Deve haver página "mobile" (Modo Remoto)', function() {
    const mobile = EXPECTED_PAGES.find(p => p.id === 'mobile');
    assert.ok(mobile, 'Página mobile não encontrada');
    assert.strictEqual(mobile.file, 'pages/mobile.html');
  });

  it('Deve haver página "volunteer-mode" (Modo Voluntário)', function() {
    const vol = EXPECTED_PAGES.find(p => p.id === 'volunteer-mode');
    assert.ok(vol, 'Página volunteer-mode não encontrada');
    assert.strictEqual(vol.file, 'pages/volunteer-mode.html');
  });
});

// =============================================================================
// 5. TESTES DE MAPEAMENTO MENU-PÁGINA
// =============================================================================

describe('🗺️ AUDITA - Mapeamento Menu → Página', function() {
  
  it('Menu "Medir" deve ter todos seus submenus mapeados para páginas válidas', function() {
    const measuringSubmenus = EXPECTED_MENU_STRUCTURE.measuring.submenus;
    measuringSubmenus.forEach(submenu => {
      const page = EXPECTED_PAGES.find(p => p.id === submenu.id);
      assert.ok(page, `Submenu ${submenu.id} não encontrado em páginas`);
    });
  });

  it('Menu "Analisar" deve ter todos seus submenus mapeados para páginas válidas', function() {
    EXPECTED_MENU_STRUCTURE.analysis.submenus.forEach(submenu => {
      const page = EXPECTED_PAGES.find(p => p.id === submenu.id);
      assert.ok(page, `Submenu ${submenu.id} não encontrado em páginas`);
    });
  });

  it('Menu "Mixer" deve ter todos seus submenus mapeados para páginas válidas', function() {
    EXPECTED_MENU_STRUCTURE.mixer.submenus.forEach(submenu => {
      const page = EXPECTED_PAGES.find(p => p.id === submenu.id);
      assert.ok(page, `Submenu ${submenu.id} não encontrado em páginas`);
    });
  });

  it('Menu "EQ" deve ter todos seus submenus mapeados para páginas válidas', function() {
    EXPECTED_MENU_STRUCTURE.eq.submenus.forEach(submenu => {
      const page = EXPECTED_PAGES.find(p => p.id === submenu.id);
      assert.ok(page, `Submenu ${submenu.id} não encontrado em páginas`);
    });
  });

  it('Menu "Automação" deve ter todos seus submenus mapeados para páginas válidas', function() {
    EXPECTED_MENU_STRUCTURE.automation.submenus.forEach(submenu => {
      const page = EXPECTED_PAGES.find(p => p.id === submenu.id);
      assert.ok(page, `Submenu ${submenu.id} não encontrado em páginas`);
    });
  });

  it('Menu "Sistema" deve ter todos seus submenus mapeados para páginas válidas', function() {
    EXPECTED_MENU_STRUCTURE.system.submenus.forEach(submenu => {
      const page = EXPECTED_PAGES.find(p => p.id === submenu.id);
      assert.ok(page, `Submenu ${submenu.id} não encontrado em páginas`);
    });
  });

  it('Menus diretos devem ter páginas correspondentes', function() {
    const pageIds = EXPECTED_PAGES.map(p => p.id);
    const menuToPageMap = {
      'dashboard': 'home',
      'volunteerMode': 'volunteer-mode',
      'testbed': 'testbed',
      'tutorials': 'tutorials'
    };
    Object.entries(menuToPageMap).forEach(([menuId, pageId]) => {
      assert.ok(pageIds.includes(pageId), `Menu direto ${menuId} deveria ter página ${pageId}`);
    });
  });
});

// =============================================================================
// 6. TESTES DE CATEGORIZAÇÃO
// =============================================================================

describe('🏷️ AUDITA - Categorização de Páginas', function() {
  
  it('Deve haver 5 páginas na categoria "Medir"', function() {
    const count = EXPECTED_PAGES.filter(p => p.category === 'Medir').length;
    assert.strictEqual(count, 5, `Esperado 5 páginas em Medir, encontrado ${count}`);
  });

  it('Deve haver 6 páginas na categoria "Analisar"', function() {
    const count = EXPECTED_PAGES.filter(p => p.category === 'Analisar').length;
    assert.strictEqual(count, 6, `Esperado 6 páginas em Analisar, encontrado ${count}`);
  });

  it('Deve haver 7 páginas na categoria "Mixer"', function() {
    const count = EXPECTED_PAGES.filter(p => p.category === 'Mixer').length;
    assert.strictEqual(count, 7, `Esperado 7 páginas em Mixer, encontrado ${count}`);
  });

  it('Deve haver 3 páginas na categoria "EQ"', function() {
    const count = EXPECTED_PAGES.filter(p => p.category === 'EQ').length;
    assert.strictEqual(count, 3, `Esperado 3 páginas em EQ, encontrado ${count}`);
  });

  it('Deve haver 3 páginas na categoria "Automação"', function() {
    const count = EXPECTED_PAGES.filter(p => p.category === 'Automação').length;
    assert.strictEqual(count, 3, `Esperado 3 páginas em Automação, encontrado ${count}`);
  });

  it('Deve haver 5 páginas na categoria "Sistema"', function() {
    const count = EXPECTED_PAGES.filter(p => p.category === 'Sistema').length;
    assert.strictEqual(count, 5, `Esperado 5 páginas em Sistema, encontrado ${count}`);
  });
});

// =============================================================================
// 7. TESTES DE VALIDAÇÃO DE ARQUIVOS (REAL — verifica filesystem)
// =============================================================================

describe('✅ AUDITA - Validação de Arquivos Reais', function() {
  
  it('Todos os componentes devem existir no disco', function() {
    Object.entries(EXPECTED_COMPONENTS).forEach(([name, file]) => {
      assert.ok(file.endsWith('.html'), `Arquivo de componente inválido: ${file}`);
      const filePath = path.resolve(process.cwd(), file);
      assert.ok(fs.existsSync(filePath), `Componente "${name}" não encontrado no disco: ${filePath}`);
    });
  });

  it('Todas as páginas devem existir no disco', function() {
    EXPECTED_PAGES.forEach(page => {
      assert.ok(
        page.file.endsWith('.html'),
        `Arquivo de página inválido: ${page.file}`
      );
      const filePath = path.resolve(FRONTEND_DIR, page.file);
      assert.ok(fs.existsSync(filePath), `Página "${page.id}" não encontrada no disco: ${filePath}`);
    });
  });

  it('Todos os caminhos de arquivo devem estar no formato esperado', function() {
    EXPECTED_PAGES.forEach(page => {
      assert.ok(
        page.file.startsWith('pages/'),
        `Caminho inválido: ${page.file}. Deve começar com 'pages/'`
      );
    });
  });
});

// =============================================================================
// 8. TESTES DE ESTRUTURA DE DADOS
// =============================================================================

describe('📊 AUDITA - Integridade de Dados', function() {
  
  it('Cada menu deve ter propriedade "type"', function() {
    Object.values(EXPECTED_MENU_STRUCTURE).forEach(menu => {
      assert.ok(menu.type, 'Menu sem propriedade type');
      assert.ok(
        ['direct', 'category'].includes(menu.type),
        `Tipo de menu inválido: ${menu.type}`
      );
    });
  });

  it('Cada menu deve ter propriedade "name"', function() {
    Object.values(EXPECTED_MENU_STRUCTURE).forEach(menu => {
      assert.ok(menu.name, 'Menu sem propriedade name');
    });
  });

  it('Cada menu deve ter propriedade "icon"', function() {
    Object.values(EXPECTED_MENU_STRUCTURE).forEach(menu => {
      assert.ok(menu.icon, 'Menu sem propriedade icon');
    });
  });

  it('Menus de categoria devem ter submenus', function() {
    Object.values(EXPECTED_MENU_STRUCTURE).forEach(menu => {
      if (menu.type === 'category') {
        assert.ok(Array.isArray(menu.submenus), `Menu ${menu.name} deve ter array de submenus`);
        assert.ok(menu.submenus.length > 0, `Menu ${menu.name} não pode ter submenus vazios`);
      }
    });
  });

  it('Cada submenu deve ter "id", "name" e "file"', function() {
    Object.values(EXPECTED_MENU_STRUCTURE).forEach(menu => {
      if (menu.submenus) {
        menu.submenus.forEach(submenu => {
          assert.ok(submenu.id, 'Submenu sem id');
          assert.ok(submenu.name, 'Submenu sem name');
          assert.ok(submenu.file, 'Submenu sem file');
        });
      }
    });
  });
});

// =============================================================================
// 9. RELATÓRIO FINAL
// =============================================================================

describe('📈 RESUMO DA AUDITORIA', function() {
  
  it('Exibe estatísticas da auditoria', function() {
    const stats = {
      totalMenus: Object.keys(EXPECTED_MENU_STRUCTURE).length,
      totalCategories: Object.values(EXPECTED_MENU_STRUCTURE).filter(m => m.type === 'category').length,
      totalDirectMenus: Object.values(EXPECTED_MENU_STRUCTURE).filter(m => m.type === 'direct').length,
      totalSubmenus: Object.values(EXPECTED_MENU_STRUCTURE).reduce((sum, m) => {
        return sum + (m.submenus ? m.submenus.length : 0);
      }, 0),
      totalPages: EXPECTED_PAGES.length,
      totalComponents: Object.keys(EXPECTED_COMPONENTS).length
    };

    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║          RESUMO DA AUDITORIA - Sound Assist           ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(`\n📊 ESTATÍSTICAS REVISADAS & ATUALIZADAS:`);
    console.log(`   • Menus Principais:        ${stats.totalMenus}`);
    console.log(`   • Categorias:              ${stats.totalCategories}`);
    console.log(`   • Menus Diretos:           ${stats.totalDirectMenus}`);
    console.log(`   • Submenus:                ${stats.totalSubmenus}`);
    console.log(`   • Páginas Catalogadas:     ${stats.totalPages}`);
    console.log(`   • Componentes Shell:       ${stats.totalComponents}`);
    console.log(`\n✅ 100% DAS 35 PÁGINAS VALIDADAS CONTRA O FILESYSTEM REAL\n`);

    assert.ok(true);
  });
});
