import { createRouter, createWebHashHistory } from 'vue-router'
import { h } from 'vue'

const VerifyRouteView = { name: 'VerifyRouteView', render: () => h('div') }

const routes = [
  { path: '/', redirect: '/browser' },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue')
  },
  {
    path: '/browser',
    name: 'browser',
    component: () => import('../views/BrowserView.vue')
  },
  {
    path: '/verify',
    name: 'verify',
    component: VerifyRouteView
  },
  {
    path: '/downloads',
    name: 'downloads',
    component: () => import('../views/DownloadsView.vue')
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('../views/HistoryView.vue')
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue')
  }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
