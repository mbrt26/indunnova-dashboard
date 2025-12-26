// Global state
let consolidatedErrors = {};
let createdIssues = [];
let analyses = {};
let filteredGroups = [];
let issueStates = {}; // Cache for issue states
let allGroups = []; // All groups before date filtering

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeDateFilters();
    loadData();
});

function initializeDateFilters() {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    // Format as YYYY-MM-DD using local timezone (not UTC)
    const formatLocalDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    document.getElementById('dateTo').value = formatLocalDate(today);
    document.getElementById('dateFrom').value = formatLocalDate(sevenDaysAgo);
}

function applyPeriodFilter() {
    const period = document.getElementById('periodFilter').value;
    const dateFromGroup = document.getElementById('dateRangeGroup');
    const dateToGroup = document.getElementById('dateRangeGroup2');
    const applyBtn = document.getElementById('applyDateBtn');

    if (period === 'custom') {
        dateFromGroup.style.display = 'flex';
        dateToGroup.style.display = 'flex';
        applyBtn.style.display = 'flex';
        // Don't auto-apply, wait for user to click Apply button
        return;
    } else {
        dateFromGroup.style.display = 'none';
        dateToGroup.style.display = 'none';
        applyBtn.style.display = 'none';

        const today = new Date();
        let fromDate = new Date(today);

        if (period === '7d') {
            fromDate.setDate(today.getDate() - 7);
        } else if (period === '30d') {
            fromDate.setDate(today.getDate() - 30);
        } else if (period === '90d') {
            fromDate.setDate(today.getDate() - 90);
        } else {
            fromDate = null; // all time
        }

        // Format as YYYY-MM-DD using local timezone
        const formatLocalDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        document.getElementById('dateTo').value = formatLocalDate(today);
        document.getElementById('dateFrom').value = fromDate ? formatLocalDate(fromDate) : '';
    }

    applyFilters();
}

async function loadData() {
    try {
        const cacheBuster = `?t=${Date.now()}`;

        // Load consolidated errors
        const consolidatedResponse = await fetch('data/consolidated_errors.json' + cacheBuster);
        if (consolidatedResponse.ok) {
            consolidatedErrors = await consolidatedResponse.json();
        } else {
            consolidatedErrors = {};
        }

        // Load created issues
        const issuesResponse = await fetch('data/created_issues.json' + cacheBuster);
        if (issuesResponse.ok) {
            createdIssues = await issuesResponse.json();
        } else {
            createdIssues = [];
        }

        // Load analyses
        const analysesResponse = await fetch('data/error_analyses.json' + cacheBuster);
        if (analysesResponse.ok) {
            analyses = await analysesResponse.json();
        } else {
            analyses = {};
        }

        // Load metadata
        const metaResponse = await fetch('data/meta.json' + cacheBuster);
        const meta = await metaResponse.json();
        document.getElementById('lastUpdate').textContent = `Ultima actualizacion: ${formatDate(meta.lastUpdate)}`;

        // Fetch issue states from GitHub API
        await fetchIssueStates();

        // Populate filters
        populateServiceFilter();

        // Update summary
        updateSummary();

        // Apply filters and render
        applyFilters();

    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('issuesList').innerHTML = `
            <div class="info-card">
                <h3>No hay datos consolidados</h3>
                <p>El sistema de consolidacion aun no se ha ejecutado. Los errores se consolidan automaticamente cada dia a las 6:00 AM UTC.</p>
                <p>Tambien puedes ejecutarlo manualmente desde GitHub Actions.</p>
            </div>
        `;
    }
}

async function fetchIssueStates() {
    // Fetch issue states from GitHub API (public repos don't need auth)
    try {
        const response = await fetch('https://api.github.com/repos/mbrt26/indunnova-dashboard/issues?state=all&per_page=100');
        if (response.ok) {
            const issues = await response.json();
            issues.forEach(issue => {
                // Extract issue number from URL
                issueStates[issue.number] = {
                    state: issue.state,
                    closed_at: issue.closed_at,
                    title: issue.title
                };
            });
        }
    } catch (error) {
        console.error('Error fetching issue states:', error);
    }
}

function getIssueState(issueUrl) {
    if (!issueUrl) return null;
    // Extract issue number from URL like "https://github.com/mbrt26/indunnova-dashboard/issues/1"
    const match = issueUrl.match(/\/issues\/(\d+)$/);
    if (match) {
        const issueNumber = parseInt(match[1]);
        return issueStates[issueNumber] || null;
    }
    return null;
}

function populateServiceFilter() {
    const services = new Set();
    Object.values(consolidatedErrors).forEach(group => {
        group.services.forEach(s => services.add(s));
    });

    const select = document.getElementById('serviceFilter');
    [...services].sort().forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        select.appendChild(option);
    });
}

function updateSummary() {
    const groups = Object.values(consolidatedErrors);
    const highPriority = groups.filter(g => g.count >= 50).length;
    const issuesCreatedCount = createdIssues.length;
    const analyzedCount = Object.keys(analyses).length;

    document.getElementById('totalGroups').textContent = groups.length;
    document.getElementById('highPriority').textContent = highPriority;
    document.getElementById('issuesCreated').textContent = issuesCreatedCount;
    document.getElementById('analyzed').textContent = analyzedCount;
}

function applyFilters() {
    const serviceFilter = document.getElementById('serviceFilter').value;
    const priorityFilter = document.getElementById('priorityFilter').value;
    const issueFilter = document.getElementById('issueFilter').value;
    const sortFilter = document.getElementById('sortFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    // Convert to array with hash
    allGroups = Object.entries(consolidatedErrors).map(([hash, data]) => {
        // Use findLast to get the most recent issue for this hash (in case there are duplicates)
        const issue = createdIssues.filter(i => i.hash === hash).pop();
        const issueState = issue ? getIssueState(issue.url) : null;
        return {
            hash,
            ...data,
            hasIssue: !!issue,
            issueUrl: issue?.url,
            issueState: issueState?.state || null,
            issueClosed: issueState?.state === 'closed',
            analysis: analyses[hash]
        };
    });

    filteredGroups = [...allGroups];

    // Apply date filter
    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        filteredGroups = filteredGroups.filter(g => {
            const lastSeen = new Date(g.last_seen);
            return lastSeen >= fromDate;
        });
    }
    if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filteredGroups = filteredGroups.filter(g => {
            const firstSeen = new Date(g.first_seen);
            return firstSeen <= toDate;
        });
    }

    // Apply service filter
    if (serviceFilter !== 'all') {
        filteredGroups = filteredGroups.filter(g => g.services.includes(serviceFilter));
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
        if (priorityFilter === 'high') {
            filteredGroups = filteredGroups.filter(g => g.count >= 50);
        } else if (priorityFilter === 'medium') {
            filteredGroups = filteredGroups.filter(g => g.count >= 10 && g.count < 50);
        } else if (priorityFilter === 'low') {
            filteredGroups = filteredGroups.filter(g => g.count >= 3 && g.count < 10);
        }
    }

    // Apply issue filter
    if (issueFilter !== 'all') {
        if (issueFilter === 'with-issue') {
            filteredGroups = filteredGroups.filter(g => g.hasIssue);
        } else if (issueFilter === 'without-issue') {
            filteredGroups = filteredGroups.filter(g => !g.hasIssue);
        } else if (issueFilter === 'open') {
            filteredGroups = filteredGroups.filter(g => g.hasIssue && !g.issueClosed);
        } else if (issueFilter === 'closed') {
            filteredGroups = filteredGroups.filter(g => g.hasIssue && g.issueClosed);
        }
    }

    // Apply sorting
    if (sortFilter === 'count') {
        filteredGroups.sort((a, b) => b.count - a.count);
    } else if (sortFilter === 'recent') {
        filteredGroups.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    } else if (sortFilter === 'services') {
        filteredGroups.sort((a, b) => b.services.length - a.services.length);
    }

    // Update progress widget with filtered data
    updateProgressWidget();

    renderGroups();
}

function updateProgressWidget() {
    const total = filteredGroups.length;
    const corrected = filteredGroups.filter(g => g.issueClosed).length;
    const detected = filteredGroups.filter(g => g.hasIssue).length;
    const pending = total - corrected;

    // Update stats
    document.getElementById('correctedCount').textContent = corrected;
    document.getElementById('detectedCount').textContent = detected;
    document.getElementById('pendingCount').textContent = pending;

    // Update progress ring
    const percent = total > 0 ? Math.round((corrected / total) * 100) : 0;
    document.getElementById('progressPercent').textContent = `${percent}%`;

    // Update SVG ring
    const ring = document.getElementById('progressRing');
    if (ring) {
        const circumference = 2 * Math.PI * 40; // radius = 40
        const offset = circumference - (percent / 100) * circumference;
        ring.style.strokeDashoffset = offset;
        ring.style.transition = 'stroke-dashoffset 0.5s ease-in-out';
    }
}

function renderGroups() {
    const container = document.getElementById('issuesList');

    if (filteredGroups.length === 0) {
        container.innerHTML = `
            <div class="info-card">
                <h3>No hay errores consolidados</h3>
                <p>No se encontraron grupos de errores con los filtros seleccionados.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredGroups.map((group, index) => {
        const priorityClass = group.count >= 50 ? 'high' : (group.count >= 10 ? 'medium' : 'low');
        const priorityLabel = group.count >= 50 ? 'Alta' : (group.count >= 10 ? 'Media' : 'Baja');

        return `
            <div class="issue-group-card priority-${priorityClass}">
                <div class="issue-group-header">
                    <div class="issue-group-info">
                        <div class="issue-group-title">${escapeHtml(group.error_type)}</div>
                        <div class="issue-group-meta">
                            <span>ID: ERROR-${group.hash}</span>
                            <span>Prioridad: ${priorityLabel}</span>
                            ${group.analysis ? '<span>🤖 Analizado</span>' : ''}
                        </div>
                    </div>
                    <div class="issue-group-badges">
                        <span class="count-badge ${priorityClass}">${group.count} ocurrencias</span>
                        ${group.hasIssue ? `<a href="${group.issueUrl}" target="_blank" class="issue-link-badge ${group.issueClosed ? 'closed' : 'open'}">${group.issueClosed ? '✅ Cerrado' : '🎫 Abierto'}</a>` : ''}
                    </div>
                </div>
                <div class="issue-group-body">
                    <div class="services-list">
                        ${group.services.map(s => `<span class="service-tag">${s}</span>`).join('')}
                    </div>
                    <div class="error-preview">${escapeHtml(truncateMessage(group.sample_message, 200))}</div>
                </div>
                <div class="issue-group-footer">
                    <div class="issue-group-times">
                        <span>Primera vez: ${formatDateShort(group.first_seen)}</span> |
                        <span>Ultima vez: ${formatDateShort(group.last_seen)}</span>
                    </div>
                    <div class="issue-group-actions">
                        <button class="action-btn" onclick="showDetails(${index})">Ver detalles</button>
                        ${!group.hasIssue && group.count >= 3 ? `<button class="action-btn primary" onclick="createIssueManual('${group.hash}')">Crear Issue</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function showDetails(index) {
    const group = filteredGroups[index];
    if (!group) return;

    document.getElementById('modalTitle').textContent = `ERROR-${group.hash}`;

    let html = '';

    // Basic info
    html += `
        <div class="modal-section">
            <h4>Informacion General</h4>
            <table class="http-info-table">
                <tr><td>ID</td><td><code>ERROR-${group.hash}</code></td></tr>
                <tr><td>Tipo</td><td>${group.error_type}</td></tr>
                <tr><td>Ocurrencias</td><td><strong>${group.count}</strong></td></tr>
                <tr><td>Servicios</td><td>${group.services.join(', ')}</td></tr>
                <tr><td>Primera vez</td><td>${formatDate(group.first_seen)}</td></tr>
                <tr><td>Ultima vez</td><td>${formatDate(group.last_seen)}</td></tr>
                ${group.hasIssue ? `<tr><td>Issue</td><td><a href="${group.issueUrl}" target="_blank">${group.issueUrl}</a></td></tr>` : ''}
            </table>
        </div>
    `;

    // Claude Analysis
    if (group.analysis && group.analysis.analysis) {
        html += `
            <div class="analysis-section">
                <h4>🤖 Analisis de Claude</h4>
                <div class="analysis-content">${formatAnalysis(group.analysis.analysis)}</div>
                <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.75rem;">
                    Analizado: ${formatDate(group.analysis.analyzed_at)}
                </p>
            </div>
        `;
    }

    // Error message
    html += `
        <div class="modal-section">
            <h4>Mensaje de Error</h4>
            <div class="error-detail-content">${escapeHtml(group.sample_message)}</div>
        </div>
    `;

    // HTTP info
    if (group.sample_http) {
        html += `
            <div class="modal-section">
                <h4>Informacion HTTP</h4>
                <table class="http-info-table">
                    <tr><td>Metodo</td><td>${group.sample_http.method}</td></tr>
                    <tr><td>URL</td><td style="word-break: break-all;">${group.sample_http.url}</td></tr>
                    <tr><td>Status</td><td>${group.sample_http.status}</td></tr>
                    <tr><td>Latencia</td><td>${group.sample_http.latency || 'N/A'}</td></tr>
                </table>
            </div>
        `;
    }

    // Recent occurrences
    if (group.occurrences && group.occurrences.length > 0) {
        html += `
            <div class="modal-section">
                <h4>Ocurrencias Recientes</h4>
                <table class="http-info-table">
                    <tr><th>Timestamp</th><th>Servicio</th><th>Revision</th></tr>
                    ${group.occurrences.map(o => `
                        <tr>
                            <td>${formatDate(o.timestamp)}</td>
                            <td>${o.service}</td>
                            <td>${o.revision || 'N/A'}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        `;
    }

    document.getElementById('issueModalBody').innerHTML = html;
    document.getElementById('issueModal').classList.add('active');
}

function closeModal() {
    document.getElementById('issueModal').classList.remove('active');
}

function createIssueManual(hash) {
    const group = filteredGroups.find(g => g.hash === hash);
    if (!group) return;

    // Build issue URL with pre-filled content
    const title = encodeURIComponent(`[ERROR-${hash}] ${group.error_type}`);
    const body = encodeURIComponent(`## Error Report

**ID:** \`ERROR-${hash}\`
**Tipo:** ${group.error_type}
**Ocurrencias:** ${group.count}
**Servicios:** ${group.services.join(', ')}

### Mensaje de Error
\`\`\`
${group.sample_message.substring(0, 2000)}
\`\`\`

---
*Creado desde el dashboard de monitoreo*
`);

    const url = `https://github.com/mbrt26/indunnova-dashboard/issues/new?title=${title}&body=${body}&labels=bug,manual`;
    window.open(url, '_blank');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('issueModal');
    if (e.target === modal) {
        closeModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// Utility functions
function formatDate(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateShort(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function truncateMessage(message, maxLength) {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatAnalysis(text) {
    if (!text) return '';
    // Convert markdown-like formatting to HTML
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/`(.*?)`/g, '<code>$1</code>');
}
