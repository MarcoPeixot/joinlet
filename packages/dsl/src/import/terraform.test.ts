import { describe, expect, it } from 'vitest';
import { importTerraform } from './terraform';
import { mainTf } from '../fixtures/import';
import { expectValid, messages } from './testkit';

const fixture = mainTf;

describe('Terraform importer', () => {
  it('creates nodes for resources with provider icons and shapes', () => {
    const result = importTerraform(fixture);
    const { model } = result;
    expect(model.elements['aws_instance.web']).toMatchObject({ label: 'Web Server', icon: 'aws-ec2', tech: 'aws_instance' });
    expect(model.elements['aws_db_instance.main']).toMatchObject({ label: 'aws_db_instance.main', icon: 'aws-rds', shape: 'cylinder' });
    expect(model.elements['aws_s3_bucket.logs']).toMatchObject({ icon: 'aws-s3', shape: 'cylinder' });
    expect(model.elements['google_compute_instance.vm']?.icon).toBe('gcp');
    expectValid(result);
  });

  it('turns references and depends_on into connections from referrer to referenced', () => {
    const { model } = importTerraform(fixture);
    const pairs = model.edges.map((e) => `${e.from}>${e.to}`);
    expect(pairs).toContain('aws_instance.web>aws_db_instance.main');
    expect(pairs).toContain('aws_s3_bucket.logs>aws_db_instance.main');
    expect(pairs).not.toContain('aws_db_instance.main>aws_s3_bucket.logs');
    expect(pairs.some((p) => p.startsWith('google_compute_instance.vm'))).toBe(false);
  });

  it('warns about module, count and unknown references', () => {
    const result = importTerraform(fixture);
    expect(messages(result).some((m) => m.includes('module') && m.includes('ignorad'))).toBe(true);
    expect(messages(result).some((m) => m.includes('count') && m.includes('ignorad'))).toBe(true);
  });

  it('warns about for_each and dynamic blocks once each', () => {
    const text = 'resource "a_b" "c" {\n for_each = var.x\n dynamic "d" {\n  content {}\n }\n}\nresource "a_b" "e" {\n for_each = var.y\n}\n';
    const result = importTerraform(text);
    expect(result.diagnostics.filter((d) => d.message.includes('for_each'))).toHaveLength(1);
    expect(result.diagnostics.filter((d) => d.message.includes('dynamic'))).toHaveLength(1);
  });

  it('handles braces inside strings, interpolations and heredocs', () => {
    const text = 'resource "a_x" "one" {\n  v = "} { \\" }"\n  w = "${lookup({a="}"}, "k")}"\n  h = <<EOT\n}}}\nEOT\n}\nresource "a_x" "two" {\n  r = a_x.one.id\n}\n';
    const { model } = importTerraform(text);
    expect(Object.keys(model.elements)).toEqual(['a_x.one', 'a_x.two']);
    expect(model.edges[0]).toMatchObject({ from: 'a_x.two', to: 'a_x.one' });
  });

  describe('hostile input', () => {
    it('accepts constructor/toString names', () => {
      const { model } = importTerraform('resource "constructor" "toString" {\n}\nresource "a" "b" {\n x = constructor.toString.id\n}\n');
      expect(model.elements['constructor.toString']).toBeDefined();
      expect(model.edges).toHaveLength(1);
    });

    it('refuses __proto__ resources with a warning', () => {
      const result = importTerraform('resource "__proto__" "x" {\n}\nresource "a" "__proto__" {\n}\n');
      expect(Object.keys(result.model.elements).some((k) => k.includes('__proto__') && k === '__proto__')).toBe(false);
      expect(messages(result).some((m) => m.includes('__proto__'))).toBe(true);
    });

    it('never throws or hangs on unbalanced, deep or junk input', () => {
      const inputs = [
        'resource "a" "b" {', '}}}}}', 'resource "a" "b" { x = "unterminated\n}',
        `resource "a" "b" {${'{'.repeat(100_000)}`, `resource "a" "b" {${'"${'.repeat(50_000)}`,
        '\u0000\u0001 resource "a"', `resource "a" "b" { x = "${'y'.repeat(1_000_000)}" }`, 'x = <<EOT\nnever ends',
        '/* never closed', `${'resource "a" "b" {}\n'.repeat(10)}`,
      ];
      for (const input of inputs) expect(() => importTerraform(input)).not.toThrow();
      expect(messages(importTerraform('resource "a" "b" {')).length).toBeGreaterThan(0);
    });

    it('caps elements and huge fan-out', () => {
      const many = Array.from({ length: 3000 }, (_, i) => `resource "t" "r${i}" {\n x = t.r0.id\n}\n`).join('');
      const result = importTerraform(many);
      expect(result.model.order.length).toBe(2000);
      expect(messages(result).some((m) => m.includes('Limite'))).toBe(true);
    });

    it('refuses input over the size limit', () => {
      const result = importTerraform(`# ${'x'.repeat(2_000_001)}`);
      expect(messages(result)[0]).toContain('grande demais');
    });
  });
});
