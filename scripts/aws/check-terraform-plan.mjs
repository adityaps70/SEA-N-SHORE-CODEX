import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export function evaluateTerraformPlan(plan) {
  const errors = []

  for (const resource of plan.resource_changes ?? []) {
    const actions = resource.change?.actions ?? []
    if (actions.includes('delete')) {
      errors.push(`Destructive action on ${resource.address}: ${actions.join(',')}`)
    }

    if (
      resource.type === 'aws_rds_cluster_instance' &&
      resource.change?.after?.publicly_accessible === true
    ) {
      errors.push(`Unsafe RDS instance ${resource.address}: publicly_accessible=true`)
    }
  }

  return { errors }
}

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: node scripts/aws/check-terraform-plan.mjs <plan.json>')
    process.exit(2)
  }

  const plan = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const { errors } = evaluateTerraformPlan(plan)
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  console.log('Terraform plan guard passed: no destructive actions or public RDS instances.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
