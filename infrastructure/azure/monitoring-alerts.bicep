@description('Name of the existing Application Insights component')
param appInsightsName string = 'appi-kaizen-wms-prod'

@description('Resource ID of the Action Group to notify on alert trigger')
param actionGroupId string = ''

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

// 1. Metric Alert: HTTP 5xx Server Error Spike (>1% or >1 failure over 5m window)
resource http5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-kaizen-wms-http-5xx-spike'
  location: 'global'
  properties: {
    description: 'Triggers when HTTP 5xx server error rate exceeds threshold over 5-minute rolling window (CHG-AZ-004)'
    severity: 1
    enabled: true
    scopes: [
      appInsights.id
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FailedRequestsCount'
          metricName: 'requests/failed'
          operator: 'GreaterThan'
          threshold: 1
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: empty(actionGroupId) ? [] : [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}

// 2. Metric Alert: Database / Dependency Latency Spike (>1000ms duration)
resource slowDependencyAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-kaizen-wms-slow-database-queries'
  location: 'global'
  properties: {
    description: 'Triggers when dependency calls (SQL queries, Redis, HTTP calls) take longer than 1000ms (CHG-AZ-004)'
    severity: 2
    enabled: true
    scopes: [
      appInsights.id
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'DependencyDuration'
          metricName: 'dependencies/duration'
          operator: 'GreaterThan'
          threshold: 1000
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: empty(actionGroupId) ? [] : [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}

