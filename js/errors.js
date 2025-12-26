// Global state
let allErrors = [];
let filteredErrors = [];
let currentPage = 1;
const errorsPerPage = 20;

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeDateFilters();
    loadErrors();
});

function initializeDateFilters() {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    document.getElementById('dateTo').value = today.toISOString().split('T')[0];
    document.getElementById('dateFrom').value = weekAgo.toISOString().split('T')[0];
}

async function loadErrors() {
    try {
        // Add cache-busting timestamp to force fresh data
        const cacheBuster = `?t=${Date.now()}`;

        // Load errors data
        const errorsResponse = await fetch('data/errors.json' + cacheBuster);
        allErrors = await errorsResponse.json();

        // Load metadata
        const metaResponse = await fetch('data/meta.json' + cacheBuster);
        const meta = await metaResponse.json();

        document.getElementById('lastUpdate').textContent = `Ultima actualizacion: ${formatDate(meta.lastUpdate)}`;

        // Populate service filter
        populateServiceFilter();

        // Apply initial filters
        applyFilters();

        // Update summary
        updateSummary();

    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('errorsList').innerHTML = '<div class="loading">Error al cargar datos. Verifique que los archivos JSON existen.</div>';
    }
}

function populateServiceFilter() {
    const services = [...new Set(allErrors.map(e => e.service))].sort();
    const select = document.getElementById('serviceFilter');

    services.forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        select.appendChild(option);
    });
}

function updateSummary() {
    const now = new Date();
    const dayAgo = new Date(now);
    dayAgo.setDate(dayAgo.getDate() - 1);

    const errors24h = allErrors.filter(e => new Date(e.timestamp) > dayAgo).length;
    const affectedServices = new Set(allErrors.map(e => e.service)).size;

    // Find service with most errors
    const errorCounts = {};
    allErrors.forEach(e => {
        errorCounts[e.service] = (errorCounts[e.service] || 0) + 1;
    });
    const topService = Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0];

    document.getElementById('totalErrors').textContent = allErrors.length;
    document.getElementById('errors24h').textContent = errors24h;
    document.getElementById('affectedServices').textContent = affectedServices;
    document.getElementById('topErrorService').textContent = topService ? topService[0] : '--';
}

function applyFilters() {
    const serviceFilter = document.getElementById('serviceFilter').value;
    const severityFilter = document.getElementById('severityFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const searchFilter = document.getElementById('searchFilter').value.toLowerCase();

    filteredErrors = allErrors.filter(error => {
        // Service filter
        if (serviceFilter !== 'all' && error.service !== serviceFilter) {
            return false;
        }

        // Severity filter
        if (severityFilter !== 'all' && error.severity !== severityFilter) {
            return false;
        }

        // Date from filter (use UTC to avoid timezone issues)
        if (dateFrom) {
            const errorDate = new Date(error.timestamp);
            // Parse as local date and set to start of day in local timezone
            const [year, month, day] = dateFrom.split('-').map(Number);
            const fromDate = new Date(year, month - 1, day, 0, 0, 0, 0);
            if (errorDate < fromDate) {
                return false;
            }
        }

        // Date to filter (use UTC to avoid timezone issues)
        if (dateTo) {
            const errorDate = new Date(error.timestamp);
            // Parse as local date and set to end of day in local timezone
            const [year, month, day] = dateTo.split('-').map(Number);
            const toDate = new Date(year, month - 1, day, 23, 59, 59, 999);
            if (errorDate > toDate) {
                return false;
            }
        }

        // Search filter
        if (searchFilter) {
            const message = (error.message || '').toLowerCase();
            const service = (error.service || '').toLowerCase();
            if (!message.includes(searchFilter) && !service.includes(searchFilter)) {
                return false;
            }
        }

        return true;
    });

    // Sort by timestamp (newest first)
    filteredErrors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Reset to page 1
    currentPage = 1;

    // Render
    renderErrors();
    updatePagination();
}

function clearFilters() {
    document.getElementById('serviceFilter').value = 'all';
    document.getElementById('severityFilter').value = 'all';
    document.getElementById('searchFilter').value = '';
    initializeDateFilters();
    applyFilters();
}

function renderErrors() {
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
        const severityClass = error.severity.toLowerCase();
        const messagePreview = truncateMessage(error.message, 300);
        const isTruncated = error.message && error.message.length > 300;

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
                    <div class="error-message-preview ${isTruncated ? 'truncated' : ''}">${escapeHtml(messagePreview)}</div>
                </div>
                <div class="error-item-footer">
                    <div class="error-item-meta">
                        <span>📦 ${error.revision || '--'}</span>
                        ${error.httpRequest ? `<span>🌐 ${error.httpRequest.method} ${truncateUrl(error.httpRequest.url)}</span>` : ''}
                        ${error.trace ? `<span>🔍 Trace disponible</span>` : ''}
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

    // Generate page numbers
    const pageNumbers = document.getElementById('pageNumbers');
    pageNumbers.innerHTML = '';

    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) {
            pageNumbers.appendChild(createPageButton(i));
        }
    } else {
        // Always show first page
        pageNumbers.appendChild(createPageButton(1));

        if (currentPage > 3) {
            pageNumbers.appendChild(createEllipsis());
        }

        // Show pages around current
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);

        for (let i = start; i <= end; i++) {
            pageNumbers.appendChild(createPageButton(i));
        }

        if (currentPage < totalPages - 2) {
            pageNumbers.appendChild(createEllipsis());
        }

        // Always show last page
        if (totalPages > 1) {
            pageNumbers.appendChild(createPageButton(totalPages));
        }
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
    renderErrors();
    updatePagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function previousPage() {
    if (currentPage > 1) {
        goToPage(currentPage - 1);
    }
}

function nextPage() {
    const totalPages = Math.ceil(filteredErrors.length / errorsPerPage);
    if (currentPage < totalPages) {
        goToPage(currentPage + 1);
    }
}

function showErrorDetails(index) {
    const error = filteredErrors[index];
    if (!error) return;

    document.getElementById('modalTitle').textContent = `Error en ${error.service}`;

    let html = '';

    // Basic info
    html += `
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
                    <span class="severity-badge ${error.severity.toLowerCase()}">${error.severity}</span>
                </div>
                <div class="error-detail-item">
                    <label>Timestamp</label>
                    <span>${formatDate(error.timestamp)}</span>
                </div>
            </div>
        </div>
    `;

    // HTTP Request info
    if (error.httpRequest) {
        const statusClass = error.httpRequest.status >= 500 ? 'status-5xx' : 'status-4xx';
        html += `
            <div class="error-detail-section">
                <h4>Request HTTP</h4>
                <table class="http-info-table">
                    <tr>
                        <td>Metodo</td>
                        <td>${error.httpRequest.method}</td>
                    </tr>
                    <tr>
                        <td>URL</td>
                        <td style="word-break: break-all;">${error.httpRequest.url}</td>
                    </tr>
                    <tr>
                        <td>Status</td>
                        <td><span class="http-status-badge ${statusClass}">${error.httpRequest.status}</span></td>
                    </tr>
                    <tr>
                        <td>Latencia</td>
                        <td>${error.httpRequest.latency || '--'}</td>
                    </tr>
                    <tr>
                        <td>IP Remota</td>
                        <td>${error.httpRequest.remoteIp || '--'}</td>
                    </tr>
                    <tr>
                        <td>User Agent</td>
                        <td style="word-break: break-all; font-size: 0.75rem;">${error.httpRequest.userAgent || '--'}</td>
                    </tr>
                </table>
            </div>
        `;
    }

    // Error message
    html += `
        <div class="error-detail-section">
            <h4>Mensaje de Error</h4>
            <div class="error-detail-content">${escapeHtml(error.message || 'Sin mensaje')}</div>
        </div>
    `;

    // Trace info
    if (error.trace || error.spanId) {
        html += `
            <div class="error-detail-section">
                <h4>Trace</h4>
                <div class="error-detail-grid">
                    ${error.trace ? `
                        <div class="error-detail-item">
                            <label>Trace ID</label>
                            <span style="font-size: 0.75rem;">${error.trace}</span>
                        </div>
                    ` : ''}
                    ${error.spanId ? `
                        <div class="error-detail-item">
                            <label>Span ID</label>
                            <span>${error.spanId}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    document.getElementById('errorModalBody').innerHTML = html;
    document.getElementById('errorModal').classList.add('active');
}

function closeErrorModal() {
    document.getElementById('errorModal').classList.remove('active');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('errorModal');
    if (e.target === modal) {
        closeErrorModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeErrorModal();
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
        minute: '2-digit',
        second: '2-digit'
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
        if (path.length > 50) {
            return path.substring(0, 50) + '...';
        }
        return path;
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
