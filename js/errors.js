// Global state
let allErrors = [];
let consolidatedErrors = {};
let errorAnalyses = {};
let filteredErrors = [];
let currentPage = 1;
let currentView = 'priority';
const errorsPerPage = 20;

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeDateFilters();
    loadAllData();
});

function initializeDateFilters() {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const formatLocalDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const dateToEl = document.getElementById('dateTo');
    const dateFromEl = document.getElementById('dateFrom');
    if (dateToEl) dateToEl.value = formatLocalDate(today);
    if (dateFromEl) dateFromEl.value = formatLocalDate(weekAgo);
}

async function loadAllData() {
    try {
        const cacheBuster = `?t=${Date.now()}`;

        // Load all data in parallel
        const [errorsRes, consolidatedRes, analysesRes, metaRes] = await Promise.all([
            fetch('data/errors.json' + cacheBuster),
            fetch('data/consolidated_errors.json' + cacheBuster),
            fetch('data/error_analyses.json' + cacheBuster),
            fetch('data/meta.json' + cacheBuster)
        ]);

        allErrors = await errorsRes.json();
        consolidatedErrors = await consolidatedRes.json();
        errorAnalyses = await analysesRes.json();
        const meta = await metaRes.json();

        document.getElementById('lastUpdate').textContent = `Ultima actualizacion: ${formatDate(meta.lastUpdate)}`;

        populateServiceFilter();
        updateSummary();
        applyFilters();

    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('groupedView').innerHTML = '<div class="loading">Error al cargar datos. Verifique que los archivos JSON existen.</div>';
    }
}

function populateServiceFilter() {
    const services = [...new Set(allErrors.map(e => e.service).filter(s => s))].sort();
    const select = document.getElementById('serviceFilter');
    select.innerHTML = '<option value="all">Todos</option>';

    services.forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        select.appendChild(option);
    });
}

function updateSummary() {
    const totalErrors = Object.values(consolidatedErrors).reduce((sum, e) => sum + e.count, 0);
    const totalGroups = Object.keys(consolidatedErrors).length;
    const allServices = new Set();
    Object.values(consolidatedErrors).forEach(e => e.services.forEach(s => allServices.add(s)));

    // Find service with most errors
    const serviceCounts = {};
    Object.values(consolidatedErrors).forEach(e => {
        e.services.forEach(s => {
            serviceCounts[s] = (serviceCounts[s] || 0) + e.count;
        });
    });
    const topService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0];

    document.getElementById('totalErrors').textContent = totalErrors.toLocaleString();
    document.getElementById('totalGroups').textContent = totalGroups;
    document.getElementById('affectedServices').textContent = allServices.size;
    document.getElementById('topErrorService').textContent = topService ? topService[0] : '--';
}

function setView(view) {
    currentView = view;

    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Toggle views
    const groupedView = document.getElementById('groupedView');
    const listView = document.getElementById('listView');

    if (view === 'list') {
        groupedView.classList.add('hidden');
        listView.classList.remove('hidden');
    } else {
        groupedView.classList.remove('hidden');
        listView.classList.add('hidden');
    }

    applyFilters();
}

function calculatePriorityScore(errorData) {
    let score = 0;

    // Frequency score
    score += errorData.count;

    // Severity score
    if (errorData.error_type === 'CRITICAL' || errorData.sample_message?.includes('CRITICAL')) {
        score += 300;
    } else if (errorData.error_type === 'OperationalError' || errorData.sample_message?.includes('Connection')) {
        score += 250;
    } else {
        score += 200;
    }

    // Recency score
    const lastSeen = new Date(errorData.last_seen);
    const now = new Date();
    const hoursAgo = (now - lastSeen) / (1000 * 60 * 60);
    if (hoursAgo < 24) {
        score += 100;
    } else if (hoursAgo < 168) {
        score += 50;
    }

    return score;
}

function getPriorityLevel(score) {
    if (score >= 500) return { level: 'critical', label: 'CRITICO', icon: '🔴' };
    if (score >= 300) return { level: 'high', label: 'ALTO', icon: '🟠' };
    if (score >= 150) return { level: 'medium', label: 'MEDIO', icon: '🟡' };
    return { level: 'low', label: 'BAJO', icon: '🟢' };
}

function applyFilters() {
    const serviceFilter = document.getElementById('serviceFilter').value;

    if (currentView === 'list') {
        applyListFilters();
    } else {
        renderGroupedView(serviceFilter);
    }
}

function renderGroupedView(serviceFilter) {
    const container = document.getElementById('groupedView');

    // Process consolidated errors
    let processedErrors = Object.entries(consolidatedErrors).map(([hash, data]) => {
        return {
            hash,
            ...data,
            score: calculatePriorityScore(data),
            hasAnalysis: !!errorAnalyses[hash]
        };
    });

    // Filter by service if selected
    if (serviceFilter !== 'all') {
        processedErrors = processedErrors.filter(e => e.services.includes(serviceFilter));
    }

    if (processedErrors.length === 0) {
        container.innerHTML = '<div class="loading">No se encontraron errores con los filtros seleccionados.</div>';
        return;
    }

    if (currentView === 'priority') {
        renderPriorityView(container, processedErrors);
    } else if (currentView === 'service') {
        renderServiceView(container, processedErrors);
    }
}

function renderPriorityView(container, errors) {
    // Sort by score descending
    errors.sort((a, b) => b.score - a.score);

    let html = '<div class="priority-list">';

    errors.forEach((error, index) => {
        const priority = getPriorityLevel(error.score);
        const errorType = error.error_type || extractErrorType(error.sample_message);
        const timeAgo = getTimeAgo(error.last_seen);

        html += `
            <div class="priority-card priority-${priority.level}">
                <div class="priority-header">
                    <div class="priority-rank">
                        <span class="rank-number">#${index + 1}</span>
                        <span class="priority-badge ${priority.level}">${priority.icon} ${priority.label}</span>
                    </div>
                    <div class="priority-score">
                        <span class="score-value">${error.count.toLocaleString()}</span>
                        <span class="score-label">ocurrencias</span>
                    </div>
                </div>
                <div class="priority-body">
                    <h3 class="error-type-title">${escapeHtml(errorType)}</h3>
                    <div class="error-services">
                        ${error.services.map(s => `<span class="service-tag">${s}</span>`).join('')}
                    </div>
                    <div class="error-timing">
                        <span>Primera vez: ${formatDate(error.first_seen)}</span>
                        <span>Ultima vez: ${timeAgo}</span>
                    </div>
                    <div class="error-message-preview-small">${escapeHtml(truncateMessage(error.sample_message, 200))}</div>
                </div>
                <div class="priority-footer">
                    ${error.hasAnalysis ?
                        `<button class="analysis-btn" onclick="showAnalysis('${error.hash}')">Ver Analisis</button>` :
                        `<span class="no-analysis">Sin analisis</span>`
                    }
                    <button class="details-btn" onclick="showOccurrences('${error.hash}')">Ver ${error.occurrences?.length || 0} ocurrencias</button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function renderServiceView(container, errors) {
    // Group by service
    const byService = {};
    errors.forEach(error => {
        error.services.forEach(service => {
            if (!byService[service]) {
                byService[service] = { errors: [], totalCount: 0 };
            }
            byService[service].errors.push(error);
            byService[service].totalCount += error.count;
        });
    });

    // Sort services by total count
    const sortedServices = Object.entries(byService)
        .sort((a, b) => b[1].totalCount - a[1].totalCount);

    let html = '<div class="service-groups">';

    sortedServices.forEach(([service, data]) => {
        // Sort errors within service by count
        data.errors.sort((a, b) => b.count - a.count);

        const criticalCount = data.errors.filter(e => getPriorityLevel(e.score).level === 'critical').length;

        html += `
            <div class="service-group">
                <div class="service-group-header" onclick="toggleServiceGroup(this)">
                    <div class="service-group-info">
                        <h3 class="service-group-name">${service || 'Sin servicio'}</h3>
                        <div class="service-group-stats">
                            <span class="stat-badge">${data.errors.length} tipos</span>
                            <span class="stat-badge">${data.totalCount.toLocaleString()} errores</span>
                            ${criticalCount > 0 ? `<span class="stat-badge critical">${criticalCount} criticos</span>` : ''}
                        </div>
                    </div>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="service-group-content expanded">
                    ${data.errors.map((error, idx) => {
                        const priority = getPriorityLevel(error.score);
                        const errorType = error.error_type || extractErrorType(error.sample_message);
                        return `
                            <div class="service-error-item">
                                <div class="service-error-info">
                                    <span class="priority-dot ${priority.level}"></span>
                                    <span class="service-error-type">${escapeHtml(errorType)}</span>
                                    <span class="service-error-count">${error.count.toLocaleString()}</span>
                                </div>
                                <div class="service-error-actions">
                                    ${error.hasAnalysis ?
                                        `<button class="btn-small" onclick="showAnalysis('${error.hash}')">Analisis</button>` :
                                        ''
                                    }
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function toggleServiceGroup(header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.expand-icon');
    content.classList.toggle('expanded');
    icon.textContent = content.classList.contains('expanded') ? '▼' : '▶';
}

function showAnalysis(hash) {
    const analysis = errorAnalyses[hash];
    const errorData = consolidatedErrors[hash];

    if (!analysis) {
        alert('No hay analisis disponible para este error');
        return;
    }

    const errorType = errorData?.error_type || extractErrorType(errorData?.sample_message);

    document.getElementById('analysisModalTitle').textContent = `Analisis: ${errorType}`;

    // Parse markdown-like content
    let htmlContent = `
        <div class="analysis-header">
            <div class="analysis-meta">
                <span><strong>Ocurrencias:</strong> ${errorData?.count?.toLocaleString() || '--'}</span>
                <span><strong>Servicios:</strong> ${errorData?.services?.join(', ') || '--'}</span>
                <span><strong>Analizado:</strong> ${formatDate(analysis.analyzed_at)}</span>
            </div>
        </div>
        <div class="analysis-content">
            ${formatAnalysisMarkdown(analysis.analysis)}
        </div>
    `;

    document.getElementById('analysisModalBody').innerHTML = htmlContent;
    document.getElementById('analysisModal').classList.add('active');
}

function formatAnalysisMarkdown(text) {
    if (!text) return '';

    // Convert markdown to HTML
    let html = text
        // Headers
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3 class="analysis-section-title">$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Code blocks
        .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
        // Lists
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        // Line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

    // Wrap lists
    html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

    return `<p>${html}</p>`;
}

function showOccurrences(hash) {
    const errorData = consolidatedErrors[hash];
    if (!errorData || !errorData.occurrences) return;

    const errorType = errorData.error_type || extractErrorType(errorData.sample_message);

    document.getElementById('modalTitle').textContent = `Ocurrencias: ${errorType}`;

    let html = `
        <div class="occurrences-summary">
            <p><strong>Total:</strong> ${errorData.count} ocurrencias</p>
            <p><strong>Servicios:</strong> ${errorData.services.join(', ')}</p>
            <p><strong>Revisiones:</strong> ${errorData.revisions?.join(', ') || '--'}</p>
        </div>
        <div class="occurrences-list">
            <h4>Ultimas ocurrencias:</h4>
            ${errorData.occurrences.slice(0, 10).map(occ => `
                <div class="occurrence-item">
                    <span class="occ-time">${formatDate(occ.timestamp)}</span>
                    <span class="occ-service">${occ.service}</span>
                    <span class="occ-revision">${occ.revision || '--'}</span>
                    ${occ.http_status ? `<span class="occ-status">${occ.http_status}</span>` : ''}
                </div>
            `).join('')}
        </div>
        <div class="sample-message">
            <h4>Mensaje de ejemplo:</h4>
            <pre class="error-detail-content">${escapeHtml(errorData.sample_message || 'Sin mensaje')}</pre>
        </div>
    `;

    document.getElementById('errorModalBody').innerHTML = html;
    document.getElementById('errorModal').classList.add('active');
}

function closeAnalysisModal() {
    document.getElementById('analysisModal').classList.remove('active');
}

function closeErrorModal() {
    document.getElementById('errorModal').classList.remove('active');
}

// Close modals on outside click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAnalysisModal();
        closeErrorModal();
    }
});

// ==================== LIST VIEW FUNCTIONS ====================

function applyListFilters() {
    const serviceFilter = document.getElementById('serviceFilter').value;
    const severityFilter = document.getElementById('severityFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const searchFilter = document.getElementById('searchFilter').value.toLowerCase();

    filteredErrors = allErrors.filter(error => {
        if (serviceFilter !== 'all' && error.service !== serviceFilter) return false;
        if (severityFilter !== 'all' && error.severity !== severityFilter) return false;

        if (dateFrom) {
            const errorDate = new Date(error.timestamp);
            const [year, month, day] = dateFrom.split('-').map(Number);
            const fromDate = new Date(year, month - 1, day, 0, 0, 0, 0);
            if (errorDate < fromDate) return false;
        }

        if (dateTo) {
            const errorDate = new Date(error.timestamp);
            const [year, month, day] = dateTo.split('-').map(Number);
            const toDate = new Date(year, month - 1, day, 23, 59, 59, 999);
            if (errorDate > toDate) return false;
        }

        if (searchFilter) {
            const message = (error.message || '').toLowerCase();
            const service = (error.service || '').toLowerCase();
            if (!message.includes(searchFilter) && !service.includes(searchFilter)) return false;
        }

        return true;
    });

    filteredErrors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    currentPage = 1;
    renderListErrors();
    updatePagination();
}

function clearFilters() {
    document.getElementById('serviceFilter').value = 'all';
    document.getElementById('severityFilter').value = 'all';
    document.getElementById('searchFilter').value = '';
    initializeDateFilters();
    applyFilters();
}

function renderListErrors() {
    const container = document.getElementById('errorsList');
    const startIndex = (currentPage - 1) * errorsPerPage;
    const endIndex = startIndex + errorsPerPage;
    const pageErrors = filteredErrors.slice(startIndex, endIndex);

    document.getElementById('resultsCount').textContent = `${filteredErrors.length} errores encontrados`;

    if (pageErrors.length === 0) {
        container.innerHTML = '<div class="loading">No se encontraron errores con los filtros seleccionados.</div>';
        return;
    }

    container.innerHTML = pageErrors.map((error, index) => {
        const severityClass = error.severity?.toLowerCase() || 'error';
        const messagePreview = truncateMessage(error.message, 300);

        return `
            <div class="error-item-card severity-${severityClass}">
                <div class="error-item-header">
                    <div class="error-item-info">
                        <span class="error-item-service">${error.service}</span>
                        <span class="error-item-timestamp">${formatDate(error.timestamp)}</span>
                    </div>
                    <div class="error-item-badges">
                        <span class="severity-badge ${severityClass}">${error.severity}</span>
                        ${error.httpRequest ? `<span class="http-status-badge status-${Math.floor(error.httpRequest.status/100)}xx">${error.httpRequest.status}</span>` : ''}
                    </div>
                </div>
                <div class="error-item-body">
                    <div class="error-message-preview">${escapeHtml(messagePreview)}</div>
                </div>
                <div class="error-item-footer">
                    <div class="error-item-meta">
                        <span>${error.revision || '--'}</span>
                        ${error.httpRequest ? `<span>${error.httpRequest.method} ${truncateUrl(error.httpRequest.url)}</span>` : ''}
                    </div>
                    <button class="view-details-btn" onclick="showErrorDetails(${startIndex + index})">Ver detalles</button>
                </div>
            </div>
        `;
    }).join('');
}

function updatePagination() {
    const totalPages = Math.ceil(filteredErrors.length / errorsPerPage);

    document.getElementById('paginationInfo').textContent = `Pagina ${currentPage} de ${totalPages || 1}`;
    document.getElementById('prevBtn').disabled = currentPage <= 1;
    document.getElementById('nextBtn').disabled = currentPage >= totalPages;

    const pageNumbers = document.getElementById('pageNumbers');
    pageNumbers.innerHTML = '';

    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) {
            pageNumbers.appendChild(createPageButton(i));
        }
    } else {
        pageNumbers.appendChild(createPageButton(1));
        if (currentPage > 3) pageNumbers.appendChild(createEllipsis());

        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);
        for (let i = start; i <= end; i++) {
            pageNumbers.appendChild(createPageButton(i));
        }

        if (currentPage < totalPages - 2) pageNumbers.appendChild(createEllipsis());
        if (totalPages > 1) pageNumbers.appendChild(createPageButton(totalPages));
    }
}

function createPageButton(pageNum) {
    const button = document.createElement('button');
    button.className = `page-number ${pageNum === currentPage ? 'active' : ''}`;
    button.textContent = pageNum;
    button.onclick = () => goToPage(pageNum);
    return button;
}

function createEllipsis() {
    const span = document.createElement('span');
    span.className = 'page-ellipsis';
    span.textContent = '...';
    return span;
}

function goToPage(page) {
    currentPage = page;
    renderListErrors();
    updatePagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function previousPage() {
    if (currentPage > 1) goToPage(currentPage - 1);
}

function nextPage() {
    const totalPages = Math.ceil(filteredErrors.length / errorsPerPage);
    if (currentPage < totalPages) goToPage(currentPage + 1);
}

function showErrorDetails(index) {
    const error = filteredErrors[index];
    if (!error) return;

    document.getElementById('modalTitle').textContent = `Error en ${error.service}`;

    let html = `
        <div class="error-detail-section">
            <h4>Informacion General</h4>
            <div class="error-detail-grid">
                <div class="error-detail-item">
                    <label>Servicio</label>
                    <span>${error.service}</span>
                </div>
                <div class="error-detail-item">
                    <label>Revision</label>
                    <span>${error.revision || '--'}</span>
                </div>
                <div class="error-detail-item">
                    <label>Severidad</label>
                    <span class="severity-badge ${error.severity?.toLowerCase()}">${error.severity}</span>
                </div>
                <div class="error-detail-item">
                    <label>Timestamp</label>
                    <span>${formatDate(error.timestamp)}</span>
                </div>
            </div>
        </div>
    `;

    if (error.httpRequest) {
        const statusClass = error.httpRequest.status >= 500 ? 'status-5xx' : 'status-4xx';
        html += `
            <div class="error-detail-section">
                <h4>Request HTTP</h4>
                <table class="http-info-table">
                    <tr><td>Metodo</td><td>${error.httpRequest.method}</td></tr>
                    <tr><td>URL</td><td style="word-break: break-all;">${error.httpRequest.url}</td></tr>
                    <tr><td>Status</td><td><span class="http-status-badge ${statusClass}">${error.httpRequest.status}</span></td></tr>
                    <tr><td>Latencia</td><td>${error.httpRequest.latency || '--'}</td></tr>
                    <tr><td>IP Remota</td><td>${error.httpRequest.remoteIp || '--'}</td></tr>
                </table>
            </div>
        `;
    }

    html += `
        <div class="error-detail-section">
            <h4>Mensaje de Error</h4>
            <div class="error-detail-content">${escapeHtml(error.message || 'Sin mensaje')}</div>
        </div>
    `;

    document.getElementById('errorModalBody').innerHTML = html;
    document.getElementById('errorModal').classList.add('active');
}

// ==================== UTILITY FUNCTIONS ====================

function extractErrorType(message) {
    if (!message) return 'Error desconocido';

    // Try to extract error type from message
    const patterns = [
        /(\w+Error):/,
        /(\w+Exception):/,
        /^(Error|ERROR):/,
        /django\.db\.utils\.(\w+)/,
        /psycopg2\.(\w+)/,
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) return match[1];
    }

    // Return first line truncated
    const firstLine = message.split('\n')[0];
    return truncateMessage(firstLine, 50);
}

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `hace ${diffMins} min`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays < 7) return `hace ${diffDays}d`;
    return formatDate(dateString);
}

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

function truncateMessage(message, maxLength) {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
}

function truncateUrl(url) {
    if (!url) return '';
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        return path.length > 50 ? path.substring(0, 50) + '...' : path;
    } catch {
        return url.length > 50 ? url.substring(0, 50) + '...' : url;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
