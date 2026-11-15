-- Planilhas geradas pelo app: cada pessoa grava na própria pasta; o link de download é temporário
drop policy if exists planilhas_gravar on storage.objects;
create policy planilhas_gravar on storage.objects for insert to authenticated
  with check (bucket_id = 'planilhas' and eh_membro() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists planilhas_ler on storage.objects;
create policy planilhas_ler on storage.objects for select to authenticated
  using (bucket_id = 'planilhas' and eh_membro() and (storage.foldername(name))[1] = auth.uid()::text);
