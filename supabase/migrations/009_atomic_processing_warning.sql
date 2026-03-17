-- Atomic append/remove for processing_error warnings.
-- Eliminates read-modify-write race in appendProcessingWarning / removeProcessingWarning.

CREATE OR REPLACE FUNCTION append_processing_warning(row_id UUID, warning TEXT)
RETURNS void AS $$
  UPDATE appearances
  SET processing_error = CASE
    WHEN processing_error IS NULL THEN warning
    ELSE processing_error || ' | ' || warning
  END
  WHERE id = row_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION remove_processing_warning(row_id UUID, prefix TEXT)
RETURNS void AS $$
  UPDATE appearances
  SET processing_error = NULLIF(
    array_to_string(
      ARRAY(
        SELECT s FROM unnest(string_to_array(processing_error, ' | ')) AS s
        WHERE NOT starts_with(s, prefix)
      ),
      ' | '
    ),
    ''
  )
  WHERE id = row_id;
$$ LANGUAGE sql;
