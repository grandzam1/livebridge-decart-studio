"use client";

import { Alert, Button, Center, Container, Stack, Text, Title } from "@mantine/core";
import { IconRefresh, IconX } from "@tabler/icons-react";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("Live studio failed to render.", error);
  }, [error]);

  return (
    <Center mih="60vh" p="md">
      <Container size="sm">
        <Stack gap="md" align="center" ta="center">
          <Title order={2}>The studio hit an unexpected error</Title>
          <Alert color="red" variant="light" icon={<IconX size={16} />} w="100%">
            <Text size="sm">
              {error instanceof globalThis.Error && error.message ? error.message : "Something went wrong while rendering this page."}
            </Text>
          </Alert>
          <Button leftSection={<IconRefresh size={16} />} color="teal" onClick={() => retry()}>
            Try again
          </Button>
        </Stack>
      </Container>
    </Center>
  );
}
