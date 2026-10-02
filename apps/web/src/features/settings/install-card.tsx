import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useInstallPrompt } from '@/pwa/use-install-prompt';

export function InstallCard() {
  const { installed, canInstall, isIos, install } = useInstallPrompt();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Install app</CardTitle>
        <CardDescription>
          Installed, it opens like a normal app and works without a connection.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {installed && <Badge>Installed</Badge>}
        {!installed && canInstall && (
          <Button onClick={() => void install()}>
            <Download /> Install
          </Button>
        )}
        {!installed && !canInstall && (
          <p className="text-muted-foreground text-sm">
            {isIos
              ? 'In Safari, tap Share, then "Add to Home Screen".'
              : 'Use your browser menu and choose "Install app" or "Add to Home screen".'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
