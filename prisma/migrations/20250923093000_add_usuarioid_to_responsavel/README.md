Migration: add usuarioId to Responsavel and backrelation to Usuario

- Adds nullable column usuarioId (TEXT)
- Adds unique index Responsavel_usuarioId_key
- Adds foreign key to Usuario(id) with ON DELETE SET NULL, ON UPDATE CASCADE

This enables linking existing Responsavel records to a created Usuario upon invite acceptance.
