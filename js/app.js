// Global data stores
let servicesData = [];
let reposData = [];
let metaData = {};
let errorsData = [];

// Load data on page load
document.addEventListener('DOMContentLoaded', loadData);

async function loadData() {
    // Show loading state
    const refreshBtn = document.querySelector('.refresh-btn');
    const refreshIcon = document.querySelector('.refresh-icon');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.style.opacity = '0.7';
    }
    if (refreshIcon) {
        refreshIcon.style.animation = 'spin 1s linear infinite';
    }

    try {
        // Add cache-busting timestamp to force fresh data
        const cacheBuster = `?t=${Date.now()}`;

        // Load services data
        const servicesResponse = await fetch('data/services.json' + cacheBuster);
        servicesData = await servicesResponse.json();

        // Load repos data
        const reposResponse = await fetch('data/repos.json' + cacheBuster);
        reposData = await reposResponse.json();

        // Load metadata
        const metaResponse = await fetch('data/meta.json' + cacheBuster);
        metaData = await metaResponse.json();

        // Load errors for chart
        try {
            const errorsResponse = await fetch('data/errors.json' + cacheBuster);
            if (errorsResponse.ok) {
                errorsData = await errorsResponse.json();
            }
        } catch (e) {
            errorsData = [];
        }

        document.getElementById('lastUpdate').textContent = `Ultima actualizacion: ${formatDate(metaData.lastUpdate)}`;

        // Render everything
        updateSummary();
        updateMetrics();
        renderDailyErrorsChart();
        renderUsageHeatmap();
        renderRecentDeployments();
        renderServices();
        renderRepos();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('servicesGrid').innerHTML = '<div class="loading">Error al cargar datos. Verifique que los archivos JSON existen.</div>';
        document.getElementById('reposGrid').innerHTML = '<div class="loading">Error al cargar datos.</div>';
    } finally {
        // Reset button state
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        }
        if (refreshIcon) {
            refreshIcon.style.animation = '';
        }
    }
}

function updateSummary() {
    document.getElementById('totalServices').textContent = metaData.totalServices || servicesData.length;
    document.getElementById('healthyServices').textContent = metaData.healthyServices || servicesData.filter(s => s.status === 'True').length;
    document.getElementById('unhealthyServices').textContent = metaData.unhealthyServices || servicesData.filter(s => s.status !== 'True').length;
    document.getElementById('totalRepos').textContent = metaData.totalRepos || reposData.length;
}

function updateMetrics() {
    document.getElementById('totalErrors7d').textContent = metaData.totalErrors7d || 0;
    document.getElementById('totalErrors24h').textContent = metaData.totalErrors24h || 0;
    document.getElementById('totalDeployments7d').textContent = metaData.totalDeployments7d || 0;
    document.getElementById('totalDeployments24h').textContent = metaData.totalDeployments24h || 0;
    document.getElementById('servicesWithErrors').textContent = metaData.servicesWithErrors || 0;
}

function renderDailyErrorsChart() {
    const container = document.getElementById('dailyErrorsChart');
    if (!container) return;

    // Group errors by day
    const dailyCounts = {};
    const today = new Date();

    // Initialize last 7 days
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const key = date.toISOString().split('T')[0];
        dailyCounts[key] = 0;
    }

    // Count errors per day
    errorsData.forEach(error => {
        if (error.timestamp) {
            const date = error.timestamp.split('T')[0];
            if (dailyCounts.hasOwnProperty(date)) {
                dailyCounts[date]++;
            }
        }
    });

    const days = Object.keys(dailyCounts).sort();
    const counts = days.map(d => dailyCounts[d]);
    const maxCount = Math.max(...counts, 1);

    // Build chart HTML
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

    let html = '<div class="chart-bars">';

    days.forEach((day, index) => {
        const count = counts[index];
        const height = (count / maxCount) * 100;
        const date = new Date(day + 'T12:00:00');
        const dayName = dayNames[date.getDay()];
        const dayNum = date.getDate();
        const isToday = index === days.length - 1;

        html += `
            <div class="chart-bar-wrapper ${isToday ? 'today' : ''}">
                <div class="chart-bar-value">${count}</div>
                <div class="chart-bar" style="height: ${Math.max(height, 2)}%"></div>
                <div class="chart-bar-label">${dayName} ${dayNum}</div>
            </div>
        `;
    });

    html += '</div>';

    // Add total
    const total = counts.reduce((a, b) => a + b, 0);
    html += `<div class="chart-total">Total: <strong>${total}</strong> errores en 7 dias</div>`;

    container.innerHTML = html;
}

function renderUsageHeatmap() {
    const container = document.getElementById('usageHeatmap');
    if (!container) return;

    // Sort services by usage (requests30d)
    const sortedServices = [...servicesData]
        .filter(s => s.interactions)
        .sort((a, b) => (b.interactions?.requests30d || 0) - (a.interactions?.requests30d || 0));

    if (sortedServices.length === 0) {
        container.innerHTML = '<div class="no-data">No hay datos de uso disponibles</div>';
        return;
    }

    // Find max value for scaling
    const maxRequests = Math.max(...sortedServices.map(s => s.interactions?.requests30d || 0));

    let html = '';

    sortedServices.forEach(service => {
        const requests7d = service.interactions?.requests7d || 0;
        const requests30d = service.interactions?.requests30d || 0;

        // Calculate intensity (0-1) based on 30d requests
        const intensity = maxRequests > 0 ? requests30d / maxRequests : 0;

        // Generate color from blue (low) to red (high)
        const hue = 200 - (intensity * 200); // 200 = blue, 0 = red
        const saturation = 70 + (intensity * 30); // 70-100%
        const lightness = 50 - (intensity * 15); // darker for higher values

        const bgColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        const textColor = intensity > 0.5 ? 'white' : 'var(--text-primary)';

        // Determine size class based on usage
        let sizeClass = 'size-sm';
        if (intensity > 0.6) sizeClass = 'size-lg';
        else if (intensity > 0.3) sizeClass = 'size-md';

        html += `
            <div class="heatmap-cell ${sizeClass}"
                 style="background-color: ${bgColor}; color: ${textColor};"
                 title="${service.name}: ${formatNumber(requests30d)} visitas (30d) / ${formatNumber(requests7d)} visitas (7d)"
                 onclick="showServiceDetails('${service.name}')">
                <span class="heatmap-name">${truncateServiceName(service.name)}</span>
                <span class="heatmap-value">${formatNumber(requests30d)}</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

function truncateServiceName(name) {
    if (name.length > 15) {
        return name.substring(0, 12) + '...';
    }
    return name;
}

function renderRecentDeployments() {
    const grid = document.getElementById('recentDeploymentsGrid');

    // Get services with recent deployments, sorted by last deployment
    const servicesWithDeployments = servicesData
        .filter(s => s.deployments && s.deployments.recentDeployments && s.deployments.recentDeployments.length > 0)
        .sort((a, b) => {
            const dateA = new Date(a.deployments.lastDeployment || 0);
            const dateB = new Date(b.deployments.lastDeployment || 0);
            return dateB - dateA;
        })
        .slice(0, 10); // Show top 10 services with recent activity

    if (servicesWithDeployments.length === 0) {
        grid.innerHTML = '<div class="no-data">No hay despliegues recientes</div>';
        return;
    }

    grid.innerHTML = servicesWithDeployments.map(service => {
        const deployments = service.deployments.recentDeployments.slice(0, 5);
        const hasErrors = service.errors && service.errors.last7d > 0;

        return `
        <div class="recent-deploy-card ${hasErrors ? 'has-errors' : ''}">
            <div class="recent-deploy-header">
                <span class="recent-deploy-service">${service.name}</span>
                <span class="recent-deploy-count">${service.deployments.last7d || 0} deploys (7d)</span>
            </div>
            <div class="recent-deploy-list">
                ${deployments.map(deploy => {
                    const isRecent = isWithinHours(deploy.timestamp, 24);
                    const statusClass = deploy.status === 'True' ? 'success' : 'warning';
                    return `
                    <div class="recent-deploy-item ${isRecent ? 'recent' : ''}">
                        <span class="deploy-status ${statusClass}">${deploy.status === 'True' ? '✓' : '!'}</span>
                        <span class="deploy-revision" title="${deploy.revision}">${truncateRevision(deploy.revision)}</span>
                        <span class="deploy-time">${formatTimeAgo(deploy.timestamp)}</span>
                    </div>
                    `;
                }).join('')}
            </div>
            ${hasErrors ? `<div class="recent-deploy-warning">⚠️ ${service.errors.last7d} errores en 7d</div>` : ''}
        </div>
        `;
    }).join('');
}

function isWithinHours(dateString, hours) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    return diffMs < (hours * 60 * 60 * 1000);
}

function formatTimeAgo(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'ahora';
    if (diffMins < 60) return `hace ${diffMins}m`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays < 7) return `hace ${diffDays}d`;
    return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
}

function truncateRevision(revision) {
    if (!revision) return '--';
    // Extract just the last part (e.g., "00072-qjd" from "service-name-00072-qjd")
    const parts = revision.split('-');
    if (parts.length >= 2) {
        return parts.slice(-2).join('-');
    }
    return revision.length > 15 ? revision.slice(-15) : revision;
}

function renderServices() {
    const grid = document.getElementById('servicesGrid');
    const statusFilter = document.getElementById('statusFilter').value;
    const sortFilter = document.getElementById('sortFilter').value;
    const searchFilter = document.getElementById('searchFilter').value.toLowerCase();

    let filtered = [...servicesData];

    // Apply status filter
    if (statusFilter === 'healthy') {
        filtered = filtered.filter(s => s.status === 'True');
    } else if (statusFilter === 'unhealthy') {
        filtered = filtered.filter(s => s.status !== 'True');
    } else if (statusFilter === 'errors') {
        filtered = filtered.filter(s => s.errors && s.errors.last7d > 0);
    }

    // Apply search filter
    if (searchFilter) {
        filtered = filtered.filter(s => s.name.toLowerCase().includes(searchFilter));
    }

    // Apply sorting
    if (sortFilter === 'errors') {
        filtered.sort((a, b) => (b.errors?.last7d || 0) - (a.errors?.last7d || 0));
    } else if (sortFilter === 'deployments') {
        filtered.sort((a, b) => (b.deployments?.last7d || 0) - (a.deployments?.last7d || 0));
    } else if (sortFilter === 'recent') {
        filtered.sort((a, b) => {
            const dateA = a.deployments?.lastDeployment ? new Date(a.deployments.lastDeployment) : new Date(0);
            const dateB = b.deployments?.lastDeployment ? new Date(b.deployments.lastDeployment) : new Date(0);
            return dateB - dateA;
        });
    } else {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="loading">No se encontraron servicios.</div>';
        return;
    }

    grid.innerHTML = filtered.map(service => {
        const hasErrors = service.errors && service.errors.last7d > 0;
        const isUnhealthy = service.status !== 'True';
        let cardClass = 'service-card';
        if (isUnhealthy) cardClass += ' unhealthy';
        else if (hasErrors) cardClass += ' has-errors';

        const errors7d = service.errors?.last7d || 0;
        const deployments7d = service.deployments?.last7d || 0;
        const lastDeploy = service.deployments?.lastDeployment;
        const requests7d = service.interactions?.requests7d || 0;
        const requests30d = service.interactions?.requests30d || 0;

        return `
        <div class="${cardClass}">
            <div class="service-header">
                <span class="service-name">${service.name}</span>
                <span class="service-status ${service.status === 'True' ? 'healthy' : 'unhealthy'}">
                    ${service.status === 'True' ? '● Activo' : '● Inactivo'}
                </span>
            </div>
            <div class="service-url">
                <a href="${service.url}" target="_blank" rel="noopener">${service.url}</a>
            </div>
            <div class="service-meta">
                <span>📍 ${service.region}</span>
                ${service.repo ? `<span>📦 <a href="${service.repo}" target="_blank" style="color: inherit;">${service.repoName || extractRepoName(service.repo)}</a></span>` : ''}
            </div>
            <div class="service-metrics">
                <div class="service-metric interactions">
                    <span class="service-metric-value">${formatNumber(requests7d)}</span>
                    <span class="service-metric-label">Visitas 7d</span>
                </div>
                <div class="service-metric interactions-30d">
                    <span class="service-metric-value">${formatNumber(requests30d)}</span>
                    <span class="service-metric-label">Visitas 30d</span>
                </div>
                <div class="service-metric errors">
                    <span class="service-metric-value">${errors7d}</span>
                    <span class="service-metric-label">Errores 7d</span>
                </div>
                <div class="service-metric deployments">
                    <span class="service-metric-value">${deployments7d}</span>
                    <span class="service-metric-label">Deploys 7d</span>
                </div>
            </div>
            <div class="service-actions">
                <button class="details-btn" onclick="showServiceDetails('${service.name}')">Ver detalles</button>
            </div>
        </div>
    `;
    }).join('');
}

function showServiceDetails(serviceName) {
    const service = servicesData.find(s => s.name === serviceName);
    if (!service) return;

    document.getElementById('modalTitle').textContent = service.name;

    let html = '';

    // Info general
    const requests7d = service.interactions?.requests7d || 0;
    const requests30d = service.interactions?.requests30d || 0;

    html += `
        <div class="modal-section">
            <h4>Informacion General</h4>
            <p><strong>URL:</strong> <a href="${service.url}" target="_blank">${service.url}</a></p>
            <p><strong>Region:</strong> ${service.region}</p>
            <p><strong>Estado:</strong> ${service.status === 'True' ? 'Activo' : 'Inactivo'}</p>
            ${service.repo ? `<p><strong>Repositorio:</strong> <a href="${service.repo}" target="_blank">${service.repoName}</a></p>` : ''}
        </div>
    `;

    // Interacciones de usuarios
    html += `
        <div class="modal-section">
            <h4>Interacciones de Usuarios</h4>
            <div class="interactions-stats">
                <div class="interaction-stat">
                    <span class="interaction-value" style="color: #06B6D4;">${formatNumber(requests7d)}</span>
                    <span class="interaction-label">Visitas ultimos 7 dias</span>
                </div>
                <div class="interaction-stat">
                    <span class="interaction-value" style="color: #8B5CF6;">${formatNumber(requests30d)}</span>
                    <span class="interaction-label">Visitas ultimos 30 dias</span>
                </div>
            </div>
        </div>
    `;

    // Errores recientes
    html += `<div class="modal-section"><h4>Errores Recientes (${service.errors?.last7d || 0} en 7 dias)</h4>`;
    if (service.errors?.recentErrors && service.errors.recentErrors.length > 0) {
        html += '<div class="error-list">';
        for (const error of service.errors.recentErrors) {
            html += `
                <div class="error-item">
                    <div class="error-timestamp">${formatDate(error.timestamp)}</div>
                    <div class="error-message">${escapeHtml(error.message)}</div>
                </div>
            `;
        }
        html += '</div>';
    } else {
        html += '<p class="no-data">No hay errores recientes</p>';
    }
    html += '</div>';

    // Despliegues recientes
    html += `<div class="modal-section"><h4>Despliegues Recientes (${service.deployments?.last7d || 0} en 7 dias)</h4>`;
    if (service.deployments?.recentDeployments && service.deployments.recentDeployments.length > 0) {
        html += '<div class="deployment-list">';
        for (const deploy of service.deployments.recentDeployments) {
            html += `
                <div class="deployment-item">
                    <span class="deployment-revision">${deploy.revision}</span>
                    <span class="deployment-time">${formatDate(deploy.timestamp)}</span>
                    <span class="deployment-status ${deploy.status === 'True' ? 'success' : ''}">${deploy.status === 'True' ? 'OK' : deploy.status}</span>
                </div>
            `;
        }
        html += '</div>';
    } else {
        html += '<p class="no-data">No hay despliegues recientes</p>';
    }
    html += '</div>';

    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('serviceModal').classList.add('active');
}

function closeModal() {
    document.getElementById('serviceModal').classList.remove('active');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('serviceModal');
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

function renderRepos() {
    const grid = document.getElementById('reposGrid');

    if (reposData.length === 0) {
        grid.innerHTML = '<div class="loading">No se encontraron repositorios.</div>';
        return;
    }

    grid.innerHTML = reposData.map(repo => `
        <div class="repo-card">
            <div class="repo-header">
                <span class="repo-name">
                    <a href="${repo.url}" target="_blank" rel="noopener">${repo.name}</a>
                </span>
            </div>
            <div class="repo-description">${repo.description || 'Sin descripcion'}</div>
            <div class="repo-meta">
                <span>🕐 ${formatDate(repo.updatedAt)}</span>
                ${repo.cloudRunService ? `<span>☁️ ${repo.cloudRunService}</span>` : ''}
            </div>
        </div>
    `).join('');
}

function filterServices() {
    renderServices();
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

function formatDateShort(dateString) {
    if (!dateString) return '--';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Hace minutos';
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
}

function extractRepoName(url) {
    if (!url) return '';
    const parts = url.split('/');
    return parts[parts.length - 1] || parts[parts.length - 2];
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num === 0) return '0';
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
}
