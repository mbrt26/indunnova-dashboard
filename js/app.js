// Global data stores
let servicesData = [];
let reposData = [];
let metaData = {};

// Load data on page load
document.addEventListener('DOMContentLoaded', loadData);

async function loadData() {
    try {
        // Load services data
        const servicesResponse = await fetch('data/services.json');
        servicesData = await servicesResponse.json();

        // Load repos data
        const reposResponse = await fetch('data/repos.json');
        reposData = await reposResponse.json();

        // Load metadata
        const metaResponse = await fetch('data/meta.json');
        metaData = await metaResponse.json();

        document.getElementById('lastUpdate').textContent = `Ultima actualizacion: ${formatDate(metaData.lastUpdate)}`;

        // Render everything
        updateSummary();
        updateMetrics();
        renderRecentDeployments();
        renderServices();
        renderRepos();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('servicesGrid').innerHTML = '<div class="loading">Error al cargar datos. Verifique que los archivos JSON existen.</div>';
        document.getElementById('reposGrid').innerHTML = '<div class="loading">Error al cargar datos.</div>';
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
                <div class="service-metric errors">
                    <span class="service-metric-value">${errors7d}</span>
                    <span class="service-metric-label">Errores 7d</span>
                </div>
                <div class="service-metric deployments">
                    <span class="service-metric-value">${deployments7d}</span>
                    <span class="service-metric-label">Despliegues 7d</span>
                </div>
                <div class="service-metric">
                    <span class="service-metric-value">${lastDeploy ? formatDateShort(lastDeploy) : '--'}</span>
                    <span class="service-metric-label">Ultimo Deploy</span>
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
    html += `
        <div class="modal-section">
            <h4>Informacion General</h4>
            <p><strong>URL:</strong> <a href="${service.url}" target="_blank">${service.url}</a></p>
            <p><strong>Region:</strong> ${service.region}</p>
            <p><strong>Estado:</strong> ${service.status === 'True' ? 'Activo' : 'Inactivo'}</p>
            ${service.repo ? `<p><strong>Repositorio:</strong> <a href="${service.repo}" target="_blank">${service.repoName}</a></p>` : ''}
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
